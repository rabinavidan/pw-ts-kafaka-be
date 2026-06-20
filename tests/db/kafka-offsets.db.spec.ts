import { test, expect } from '../../src/fixtures';
import { v4 as uuidv4 } from 'uuid';

test.describe('DB Layer — kafka_consumer_offsets table @db', () => {
  test('inserts an offset and reads it back', async ({ db }) => {
    const group = `group-${uuidv4()}`;

    const row = await db.upsertKafkaOffset({ consumer_group: group, topic: 'orders', partition: 0, committed_offset: 42 });

    expect(row.consumer_group).toBe(group);
    expect(row.topic).toBe('orders');
    expect(row.partition).toBe(0);
    expect(Number(row.committed_offset)).toBe(42);
    expect(row.updated_at).toBeInstanceOf(Date);

    await db.deleteKafkaOffset(group, 'orders', 0);
  });

  test('findKafkaOffset returns null for unknown entry', async ({ db }) => {
    const result = await db.findKafkaOffset(`group-${uuidv4()}`, 'orders', 0);
    expect(result).toBeNull();
  });

  test('upsert updates committed_offset on conflict', async ({ db }) => {
    const group = `group-${uuidv4()}`;

    await db.upsertKafkaOffset({ consumer_group: group, topic: 'orders', partition: 0, committed_offset: 10 });
    const updated = await db.upsertKafkaOffset({ consumer_group: group, topic: 'orders', partition: 0, committed_offset: 55 });

    expect(Number(updated.committed_offset)).toBe(55);

    await db.deleteKafkaOffset(group, 'orders', 0);
  });

  test('deleteKafkaOffset removes the entry and returns true', async ({ db }) => {
    const group = `group-${uuidv4()}`;
    await db.upsertKafkaOffset({ consumer_group: group, topic: 'payments', partition: 1, committed_offset: 0 });

    expect(await db.deleteKafkaOffset(group, 'payments', 1)).toBe(true);
    expect(await db.findKafkaOffset(group, 'payments', 1)).toBeNull();
  });

  test('deleteKafkaOffset returns false for non-existent entry', async ({ db }) => {
    expect(await db.deleteKafkaOffset(`group-${uuidv4()}`, 'orders', 99)).toBe(false);
  });

  test('composite primary key allows same group on different partitions', async ({ db }) => {
    const group = `group-${uuidv4()}`;

    const p0 = await db.upsertKafkaOffset({ consumer_group: group, topic: 'orders', partition: 0, committed_offset: 1 });
    const p1 = await db.upsertKafkaOffset({ consumer_group: group, topic: 'orders', partition: 1, committed_offset: 2 });
    const p2 = await db.upsertKafkaOffset({ consumer_group: group, topic: 'orders', partition: 2, committed_offset: 3 });

    expect(Number(p0.committed_offset)).toBe(1);
    expect(Number(p1.committed_offset)).toBe(2);
    expect(Number(p2.committed_offset)).toBe(3);

    await db.deleteKafkaOffset(group, 'orders', 0);
    await db.deleteKafkaOffset(group, 'orders', 1);
    await db.deleteKafkaOffset(group, 'orders', 2);
  });

  test('composite primary key allows same group across different topics', async ({ db }) => {
    const group = `group-${uuidv4()}`;

    await db.upsertKafkaOffset({ consumer_group: group, topic: 'orders', partition: 0, committed_offset: 10 });
    await db.upsertKafkaOffset({ consumer_group: group, topic: 'payments', partition: 0, committed_offset: 20 });

    const o = await db.findKafkaOffset(group, 'orders', 0);
    const p = await db.findKafkaOffset(group, 'payments', 0);

    expect(Number(o!.committed_offset)).toBe(10);
    expect(Number(p!.committed_offset)).toBe(20);

    await db.deleteKafkaOffset(group, 'orders', 0);
    await db.deleteKafkaOffset(group, 'payments', 0);
  });

  test('default committed_offset is 0 when not specified', async ({ db }) => {
    const group = `group-${uuidv4()}`;
    const row = await db.upsertKafkaOffset({ consumer_group: group, topic: 'orders', partition: 0 });

    expect(Number(row.committed_offset)).toBe(0);

    await db.deleteKafkaOffset(group, 'orders', 0);
  });
});
