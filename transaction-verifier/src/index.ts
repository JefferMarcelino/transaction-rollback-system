import { PrismaClient } from "@prisma/client";
import amqp, { Connection, Channel, ConsumeMessage } from "amqplib";
import { PrismaClient as PrismaClientCredelec } from '../prisma_credelec/generated/prisma_credelec/';
import { PrismaClient as PrismaClientTransaction } from '../prisma_transaction/generated/prisma_transaction';
import "dotenv/config";


const prismaCredelec = new PrismaClientCredelec();
const prismaTransaction = new PrismaClientTransaction();
const QUEUE_URL: string = process.env.QUEUE_URL || "amqp://localhost";
const TRANSACTION_VERIFIER_NAME: string = process.env.TRANSACTION_VERIFIER_NAME || "";

async function connectRabbitMQ(): Promise<{ connection: Connection, channel: Channel }> {
  const connection: Connection = await amqp.connect(QUEUE_URL);
  const channel: Channel = await connection.createChannel();

  return { connection, channel };
};

async function requeueMessage(channel: Channel, msg: ConsumeMessage, queueName: string): Promise<void> {
  channel.sendToQueue(queueName, msg.content, { persistent: true });
  channel.ack(msg);
}

async function startConsumer(): Promise<void> {
  try {
    const { connection, channel } = await connectRabbitMQ();

    await channel.assertQueue(TRANSACTION_VERIFIER_NAME, { durable: true });

    channel.consume(TRANSACTION_VERIFIER_NAME, async (msg: ConsumeMessage | null) => {
      if (msg) {
        const messageContent: string = msg.content.toString();

        const data = JSON.parse(messageContent) as { userId: string; amount: number; transactionId: string };

        const credelecT = await prismaCredelec.credelec.findUnique({
          where: {
            id: data.transactionId
          }
        });

        if (!credelecT) {
          await requeueMessage(channel, msg, TRANSACTION_VERIFIER_NAME);
        } else if(credelecT && credelecT.status === 0) {
          await prismaTransaction.user.update({
            data: {
              balance: {
                increment: data.amount
              }
            },
            where: {
              id: data.userId
            }
          });

          console.log(`Transaction ${ data.transactionId } reverted`);
          channel.ack(msg);
        } else if (credelecT && credelecT.status === 1) {
          channel.ack(msg);
        }
      }
    }, { noAck: false });

    process.on("beforeExit", async () => {
      console.log("Closing RabbitMQ channel and connection...");
      await channel.close();
      await connection.close();
    });
  } catch (error) {
    console.error("Error starting consumer:", error);
  }
}

startConsumer().catch(console.error);