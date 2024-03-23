import { PrismaClient } from "@prisma/client";
import amqp, { Connection, Channel, ConsumeMessage } from "amqplib";
import "dotenv/config";

const prisma = new PrismaClient();

const QUEUE_URL: string = process.env.QUEUE_URL || "amqp://localhost";
const CREDELEC_QUEUE_NAME: string = process.env.CREDELEC_QUEUE_NAME || "";

async function connectRabbitMQ(): Promise<{ connection: Connection, channel: Channel }> {
  const connection: Connection = await amqp.connect(QUEUE_URL);
  const channel: Channel = await connection.createChannel();

  return { connection, channel };
};

function generateNumber(): string {
  let number = "";

  for (let i = 0; i < 5; i++) {
    const segment = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    number += (i === 0) ? segment : " " + segment;
  };

  return number;
};

function randomBoolean(): boolean {
  return Math.random() >= 0.5;
}

async function startConsumer(): Promise<void> {
  try {
    const { connection, channel } = await connectRabbitMQ();

    await channel.assertQueue(CREDELEC_QUEUE_NAME, { durable: true });

    channel.consume(CREDELEC_QUEUE_NAME, (msg: ConsumeMessage | null) => {
      if (msg) {
        const messageContent: string = msg.content.toString();

        setTimeout(async () => {
          const data = JSON.parse(messageContent) as { userId: string; amount: number; transactionId: string };

          await prisma.credelec.create({
            data: {
              code: generateNumber(),
              status: randomBoolean() ? 1 : 0,
              userId: data.userId,
              id: data.transactionId
            }
          });

          channel.ack(msg);
        }, 5000);
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