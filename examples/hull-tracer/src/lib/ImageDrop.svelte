<script lang="ts">
  // Client-side image intake. The file is turned into a `blob:` object URL that
  // lives only in this browser tab and read for its natural pixel dimensions —
  // it is never uploaded, fetched, or written anywhere. The parent owns the URL
  // lifecycle (revocation) via the emitted value.
  let {
    onImage,
  }: {
    onImage: (img: { url: string; width: number; height: number; name: string }) => void;
  } = $props();

  let dragOver = $state(false);
  let error = $state<string | null>(null);

  function accept(file: File | undefined | null): void {
    error = null;
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      error = "That file isn't an image.";
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      onImage({ url, width: img.naturalWidth, height: img.naturalHeight, name: file.name });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      error = "Couldn't read that image.";
    };
    img.src = url;
  }

  function onInput(e: Event): void {
    accept((e.currentTarget as HTMLInputElement).files?.[0]);
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragOver = false;
    accept(e.dataTransfer?.files?.[0]);
  }
</script>

<div
  class="drop"
  class:over={dragOver}
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={onDrop}
  role="region"
  aria-label="Upload a top-down image"
>
  <p class="lead">Drop a top-down photo here</p>
  <p class="or">or</p>
  <label class="pick focus-ring">
    Choose image
    <input type="file" accept="image/*" onchange={onInput} />
  </label>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <p class="privacy">
    Your image stays in your browser — it is never uploaded or saved. Only the polygon you trace is
    exported.
  </p>
</div>

<style>
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2, 8px);
    padding: 32px 20px;
    border: 1.5px dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    text-align: center;
  }
  .drop.over {
    border-color: var(--color-accent);
    background: color-mix(in oklch, var(--color-accent) 8%, var(--color-panel));
  }
  .lead {
    margin: 0;
    font-family: var(--font-heading);
    font-size: 18px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text);
  }
  .or {
    margin: 0;
    color: var(--color-text-dim);
    font-size: 12px;
  }
  .pick {
    display: inline-block;
    padding: 8px 16px;
    border-radius: var(--radius-md);
    background: var(--color-accent);
    color: var(--color-accent-foreground);
    font-family: var(--font-heading);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    cursor: pointer;
  }
  .pick:hover {
    background: var(--color-accent-hover);
  }
  .pick input {
    display: none;
  }
  .err {
    margin: 0;
    color: var(--color-danger);
    font-size: 12px;
  }
  .privacy {
    margin: 8px 0 0;
    max-width: 36ch;
    font-size: 11px;
    color: var(--color-text-dim);
    line-height: 1.4;
  }
</style>
