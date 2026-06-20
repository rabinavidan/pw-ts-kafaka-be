import { useEvents } from '../hooks/useEvents';

const TYPE_CLASS: Record<string, string> = {
  'order.created':      'et-order-created',
  'order.confirmed':    'et-order-confirmed',
  'order.cancelled':    'et-order-cancelled',
  'payment.initiated':  'et-payment-initiated',
  'payment.failed':     'et-payment-failed',
  'payment.processed':  'et-payment-processed',
  'payment.refunded':   'et-payment-refunded',
};

function ago(ts: string): string {
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 5)   return 'just now';
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function EventFeed() {
  const events = useEvents();

  return (
    <aside className="event-sidebar" data-testid="event-sidebar">
      <div className="feed-head">
        <span className="feed-head-title">⚡ Kafka Events</span>
        {events.length > 0 && <span className="feed-count" data-testid="event-count">{events.length}</span>}
      </div>
      <div className="feed-list" data-testid="event-feed-list">
        {events.length === 0 ? (
          <div className="feed-empty" data-testid="event-feed-empty">
            No events yet.<br />
            Create an order to see<br />
            Kafka events appear here.
          </div>
        ) : (
          events.map(ev => (
            <div key={ev.id} className="ev-item" data-testid={`event-item-${ev.id}`} data-event-type={ev.eventType}>
              <div className={`ev-type ${TYPE_CLASS[ev.eventType] ?? 'et-default'}`} data-testid="event-type">
                {ev.eventType}
              </div>
              <div className="ev-topic" data-testid="event-topic">↪ {ev.topic}</div>
              <div className="ev-key" title={ev.key} data-testid="event-key">
                {(ev.key ?? '').length > 28 ? `${ev.key!.slice(0, 27)}…` : (ev.key ?? '—')}
              </div>
              <div className="ev-time" data-testid="event-time">{ago(ev.timestamp)}</div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
