<!--
  A status chip: text with a small shape, never colour alone (docs/UI.md section 3). The words are the
  fixed ones from docs/UI.md section 6.
-->
<script lang="ts" module>
  export type ChipKind =
    | 'verified'
    | 'pending'
    | 'mismatch'
    | 'simulated only'
    | 'estimated'
    | 'prediction'
    | 'assumed'
    | 'not yet confirmed on hardware'
    | 'sent'
    | 'clamped'
    | 'waiting'
    | 'refused';

  const SHAPE: Record<ChipKind, string> = {
    verified: '✓',
    pending: '○',
    mismatch: '▲',
    'simulated only': '◇',
    estimated: '≈',
    prediction: '≈',
    assumed: '?',
    'not yet confirmed on hardware': '?',
    sent: '✓',
    clamped: '▼',
    waiting: '…',
    refused: '✕',
  };

  const TONE: Record<ChipKind, 'plain' | 'warn' | 'danger'> = {
    verified: 'plain',
    pending: 'plain',
    mismatch: 'warn',
    'simulated only': 'plain',
    estimated: 'plain',
    prediction: 'plain',
    assumed: 'warn',
    'not yet confirmed on hardware': 'warn',
    sent: 'plain',
    clamped: 'warn',
    waiting: 'plain',
    refused: 'danger',
  };
</script>

<script lang="ts">
  let { kind, testid }: { kind: ChipKind; testid?: string } = $props();
</script>

<span class="chip {TONE[kind]}" data-testid={testid}
  ><span class="shape" aria-hidden="true">{SHAPE[kind]}</span>{kind}</span
>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    font-size: var(--size-1);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .warn {
    border-color: var(--warn);
    color: var(--warn);
  }
  .danger {
    border-color: var(--danger);
    color: var(--danger);
  }
</style>
