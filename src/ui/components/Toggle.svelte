<!-- A toggle: a native checkbox with the switch role, styled (docs/UI.md section 3). -->
<script lang="ts">
  let {
    label,
    checked,
    onchange,
    disabled = false,
    testid,
  }: {
    label: string;
    checked: boolean;
    onchange: (v: boolean) => void;
    disabled?: boolean;
    testid?: string | undefined;
  } = $props();
</script>

<label class="toggle" data-testid={testid}>
  <input
    type="checkbox"
    role="switch"
    {checked}
    {disabled}
    onchange={(e) => {
      onchange(e.currentTarget.checked);
    }}
  />
  <span>{label}</span>
  <span class="state muted small" aria-hidden="true">{checked ? 'on' : 'off'}</span>
</label>

<style>
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
  }
  input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    margin: 0;
  }
</style>
