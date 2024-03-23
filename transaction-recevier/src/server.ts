import fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";
import amqp from "amqplib";
import "dotenv/config";

const PORT = Number(process.env.TRANSACTION_RECEVIER_PORT) || 3000;
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";
const CREDELEC_QUEUE_NAME = process.env.CREDELEC_QUEUE_NAME || "";
const TRANSACTION_VERIFIER_NAME = process.env.TRANSACTION_VERIFIER_NAME || "";

const app = fastify();
const prisma = new PrismaClient();

let connection: any;
let channel: any;

(async () => {
  try {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    console.log("Connected to RabbitMQ");
  } catch (error) {
    console.error("Error connecting to RabbitMQ:", error);
    process.exit(1);
  }
})();

app.register(cors);

app.get("/health", async (request, reply) => {
  return { message: "oky" };
});

app.post("/transaction", async (request, reply) => {
  try {
    const { body } = request;

    const data = body as { userId: string; amount: number };

    if (!data || !data.userId || (!data.amount && data.amount !== 0) || data.amount < 0) {
      return reply.status(400).send({ message: "Invalid request" });
    };

    const user = await prisma.user.findUnique({
      where: {
        id: data.userId,
      }
    });

    if (!user) {
      return reply.status(404).send({ message: "User not found" });
    };

    if (user.balance < data.amount) {
      return reply.status(400).send({ message: `Insufficient balance, your current balance is ${user.balance} MTn` });
    };

    const userNewBalance = user.balance - data.amount;

    await prisma.user.update({
      where: {
        id: data.userId,
      },
      data: {
        balance: userNewBalance,
      }
    });

    const transaction = await prisma.transaction.create({
      data: {
        amount: data.amount,
        userId: user.id
      }
    });

    await channel.assertQueue(CREDELEC_QUEUE_NAME, { durable: true });
    await channel.assertQueue(TRANSACTION_VERIFIER_NAME, { durable: true });

    const toBeQueued = Buffer.from(JSON.stringify({ 
      userId: data.userId, 
      amount: data.amount, 
      transactionId: transaction.id 
    }));

    channel.sendToQueue(CREDELEC_QUEUE_NAME, toBeQueued, { persistent: true });
    channel.sendToQueue(TRANSACTION_VERIFIER_NAME, toBeQueued, { persistent: true });
    
    return { message: `Transaction happened sucessuful, your new balance is ${ userNewBalance } MTn` };
  } catch (error) {
    console.error(error);
    return reply.status(500).send({ message: "Internal server error" });
  }
});

app.listen({
  port: PORT,
  host: "0.0.0.0",
}).then((address) => {
  console.log(`Server listening on ${address}`);
});

process.on('beforeExit', async () => {
  console.log('Closing RabbitMQ connection...');
  await channel.close();
  await connection.close();
});