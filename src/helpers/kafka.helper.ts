import { Kafka, Producer, Consumer, Admin, RecordMetadata, EachMessagePayload } from 'kafkajs';
import { kafkaConfig, consumerConfig } from '../config/kafka.config';
import { KafkaMessage, ConsumedMessage } from '../models/kafka.model';
import { logger } from '../utils/logger';
import { waitUntil } from '../utils/retry';

export class KafkaHelper {
  private readonly kafka: Kafka;
  private producer: Producer | null = null;
  private consumers: Consumer[] = [];
  private admin: Admin | null = null;

  constructor() {
    this.kafka = new Kafka({
      ...kafkaConfig,
      logCreator: () => () => {},
    });
  }

  async connect(): Promise<void> {
    this.producer = this.kafka.producer({ allowAutoTopicCreation: true });
    this.admin = this.kafka.admin();
    await Promise.all([this.producer.connect(), this.admin.connect()]);
    logger.info('Kafka producer and admin connected');
  }

  async disconnect(): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (this.producer) tasks.push(this.producer.disconnect());
    if (this.admin) tasks.push(this.admin.disconnect());
    for (const consumer of this.consumers) tasks.push(consumer.disconnect());
    await Promise.allSettled(tasks);
    this.producer = null;
    this.admin = null;
    this.consumers = [];
    logger.info('Kafka connections closed');
  }

  async produce<T>(topic: string, message: KafkaMessage<T>): Promise<RecordMetadata[]> {
    if (!this.producer) throw new Error('Producer not connected. Call connect() first.');

    const result = await this.producer.send({
      topic,
      messages: [
        {
          key: message.key,
          value: JSON.stringify(message.value),
          headers: message.headers,
          timestamp: message.timestamp || Date.now().toString(),
        },
      ],
    });

    logger.info(`Produced message to ${topic}`, { key: message.key, partition: result[0]?.partition });
    return result;
  }

  /**
   * Sends a raw, un-encoded string as the message value — unlike produce(),
   * this does NOT JSON.stringify it. Used to construct a genuinely
   * malformed/unparseable message body (a "poison message") for resilience
   * tests; produce() can't do this since JSON.stringify('anything') is
   * always valid JSON.
   */
  async produceRaw(topic: string, key: string, rawValue: string, headers?: Record<string, string>): Promise<RecordMetadata[]> {
    if (!this.producer) throw new Error('Producer not connected. Call connect() first.');

    const result = await this.producer.send({
      topic,
      messages: [{ key, value: rawValue, headers, timestamp: Date.now().toString() }],
    });

    logger.info(`Produced raw message to ${topic}`, { key, partition: result[0]?.partition });
    return result;
  }

  async produceMany<T>(topic: string, messages: KafkaMessage<T>[]): Promise<RecordMetadata[]> {
    if (!this.producer) throw new Error('Producer not connected. Call connect() first.');

    const result = await this.producer.send({
      topic,
      messages: messages.map((m) => ({
        key: m.key,
        value: JSON.stringify(m.value),
        headers: m.headers,
        timestamp: m.timestamp || Date.now().toString(),
      })),
    });

    logger.info(`Produced ${messages.length} messages to ${topic}`);
    return result;
  }

  async consume<T>(
    topic: string,
    options: { count?: number; timeoutMs?: number; filter?: (msg: ConsumedMessage<T>) => boolean } = {},
  ): Promise<ConsumedMessage<T>[]> {
    const { count = 1, timeoutMs = 30000, filter } = options;
    const collected: ConsumedMessage<T>[] = [];
    const groupId = `${consumerConfig.groupId}-${Date.now()}`;

    const consumer = this.kafka.consumer({ groupId, sessionTimeout: consumerConfig.sessionTimeout, heartbeatInterval: consumerConfig.heartbeatInterval, maxWaitTimeInMs: consumerConfig.maxWaitTimeInMs });
    this.consumers.push(consumer);

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: true });

    try {
      await consumer.run({
        eachMessage: async ({ topic: t, partition, message }: EachMessagePayload) => {
          const parsed: ConsumedMessage<T> = {
            topic: t,
            partition,
            offset: message.offset,
            key: message.key ? message.key.toString() : null,
            value: JSON.parse(message.value?.toString() || 'null') as T,
            headers: Object.fromEntries(
              Object.entries(message.headers || {}).map(([k, v]) => [k, v ? v.toString() : '']),
            ),
            timestamp: message.timestamp,
          };

          if (!filter || filter(parsed)) {
            collected.push(parsed);
          }
        },
      });

      // Add a 75s buffer on top of the caller's timeout to absorb consumer group join and
      // partition assignment delays. These are usually 20-30s when multiple projects run
      // concurrently, but even fully serialized (one consumer group at a time) the CI broker's
      // group-coordinator can occasionally take well past 45s on a single join.
      // Reverted from a 120s buffer (2026-09-01): widening it further did not help and made
      // things measurably worse — a run with the 120s buffer produced 4 cascading test
      // failures with zero recoveries across 3 retries each (28 minutes total), versus this
      // failure mode's prior history of at most 1 test failing per run at 75s. The working
      // theory is that a longer buffer gives a stuck consumer more time to sit before its
      // retry can land outside whatever transient bad window caused the stall, rather than
      // failing fast and getting more attempts in the same wall-clock budget. See ADR-0004
      // for the full history — root cause is still unconfirmed.
      // The wait exits as soon as messages arrive, so fast runs are unaffected.
      await waitUntil(() => Promise.resolve(collected.length >= count), timeoutMs + 75000, 200);
    } finally {
      // Must run even when waitUntil throws on timeout — otherwise a timed-out consumer is
      // never disconnected, leaving it (and its heartbeat timers) as a live group member for
      // the rest of this fixture's lifecycle instead of being torn down immediately.
      await consumer.disconnect();
    }

    logger.info(`Consumed ${collected.length} messages from ${topic}`);
    return collected;
  }

  async createTopics(topics: Array<{ topic: string; numPartitions?: number; replicationFactor?: number }>): Promise<void> {
    if (!this.admin) throw new Error('Admin not connected.');

    await this.admin.createTopics({
      waitForLeaders: true,
      topics: topics.map((t) => ({
        topic: t.topic,
        numPartitions: t.numPartitions ?? 1,
        replicationFactor: t.replicationFactor ?? 1,
      })),
    });

    logger.info(`Created topics: ${topics.map((t) => t.topic).join(', ')}`);
  }

  async deleteTopics(topics: string[]): Promise<void> {
    if (!this.admin) throw new Error('Admin not connected.');
    await this.admin.deleteTopics({ topics });
    logger.info(`Deleted topics: ${topics.join(', ')}`);
  }

  async topicExists(topic: string): Promise<boolean> {
    if (!this.admin) throw new Error('Admin not connected.');
    const topics = await this.admin.listTopics();
    return topics.includes(topic);
  }

  async getTopicOffsets(topic: string): Promise<Array<{ partition: number; offset: string }>> {
    if (!this.admin) throw new Error('Admin not connected.');
    return this.admin.fetchTopicOffsets(topic);
  }

  async waitForMessage<T>(
    topic: string,
    predicate: (msg: ConsumedMessage<T>) => boolean,
    timeoutMs = 30000,
  ): Promise<ConsumedMessage<T>> {
    const messages = await this.consume<T>(topic, { count: 1, timeoutMs, filter: predicate });
    if (messages.length === 0) throw new Error(`No matching message received from ${topic} within ${timeoutMs}ms`);
    return messages[0];
  }
}
