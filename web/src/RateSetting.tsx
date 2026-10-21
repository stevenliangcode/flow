import { useEffect, useState } from 'react';

interface Props {
  rateCents: number;
  sessionActive: boolean;
  onSave: (rateCents: number) => void;
}

export function RateSetting({ rateCents, sessionActive, onSave }: Props) {
  const [draft, setDraft] = useState((rateCents / 100).toFixed(2));
  useEffect(() => setDraft((rateCents / 100).toFixed(2)), [rateCents]);

  const save = () => {
    const cents = Math.round(Number(draft) * 100);
    if (Number.isFinite(cents) && cents >= 1 && cents !== rateCents) onSave(cents);
    else setDraft((rateCents / 100).toFixed(2));
  };

  return (
    <label className="rate">
      Pay rate
      <span className="rate-input">
        $
        <input
          type="number"
          min="0.01"
          step="0.25"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        / min
      </span>
      {sessionActive && <span className="rate-note">Changes apply from your next session</span>}
    </label>
  );
}
