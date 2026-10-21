import type { HistoryEntry } from '../../shared/types';
import { formatDay, formatDuration, formatMoney, formatTime } from './format';

export function History({ entries }: { entries: HistoryEntry[] }) {
  return (
    <section className="card history">
      <h2>History</h2>
      {entries.length === 0 ? (
        <p className="empty">Your finished sessions will show up here.</p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              <div className="when">
                <span className="day">{formatDay(e.startedAt)}</span>
                <span className="range">
                  {formatTime(e.startedAt)} – {formatTime(e.endedAt)}
                </span>
              </div>
              <span className="duration">{formatDuration(e.activeMs)}</span>
              <span className="amount">{formatMoney(e.earnedCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
