@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --button-outline: rgba(255, 255, 255, 0.1);
  --badge-outline: rgba(255, 255, 255, 0.08);
  --opaque-button-border-intensity: 8;
  --elevate-1: rgba(255, 255, 255, 0.04);
  --elevate-2: rgba(255, 255, 255, 0.08);

  --background: 250 21% 6%;
  --foreground: 252 24% 94%;
  --border: 252 13% 18%;
  --card: 250 18% 9%;
  --card-foreground: 252 24% 94%;
  --card-border: 252 12% 16%;
  --sidebar: 252 20% 7%;
  --sidebar-foreground: 252 18% 88%;
  --sidebar-border: 252 13% 15%;
  --sidebar-primary: 264 79% 66%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 252 16% 13%;
  --sidebar-accent-foreground: 252 24% 94%;
  --sidebar-ring: 264 79% 66%;
  --popover: 250 18% 9%;
  --popover-foreground: 252 24% 94%;
  --popover-border: 252 12% 16%;
  --primary: 264 79% 66%;
  --primary-foreground: 0 0% 100%;
  --secondary: 252 16% 14%;
  --secondary-foreground: 252 24% 94%;
  --muted: 252 13% 15%;
  --muted-foreground: 250 10% 63%;
  --accent: 264 42% 17%;
  --accent-foreground: 264 95% 84%;
  --destructive: 348 78% 58%;
  --destructive-foreground: 0 0% 100%;
  --input: 252 13% 24%;
  --ring: 264 79% 66%;
  --chart-1: 264 79% 66%;
  --chart-2: 190 83% 52%;
  --chart-3: 38 92% 58%;
  --chart-4: 145 62% 47%;
  --chart-5: 348 78% 58%;
  --font-sans: "Satoshi", "Inter", sans-serif;
  --font-serif: Georgia, serif;
  --font-mono: "Geist Mono", "JetBrains Mono", monospace;
  --radius: 0.625rem;
  --shadow-2xs: 0 1px 2px 0 hsl(0 0% 0% / 0.2);
  --shadow-xs: 0 1px 2px 0 hsl(0 0% 0% / 0.26);
  --shadow-sm: 0 2px 6px -2px hsl(0 0% 0% / 0.42);
  --shadow: 0 10px 28px -18px hsl(0 0% 0% / 0.55);
  --shadow-md: 0 18px 48px -24px hsl(0 0% 0% / 0.66);
  --shadow-lg: 0 24px 70px -28px hsl(0 0% 0% / 0.75);
  --shadow-xl: 0 30px 90px -32px hsl(0 0% 0% / 0.82);
  --shadow-2xl: 0 40px 120px -36px hsl(0 0% 0% / 0.88);
  --tracking-normal: 0em;
  --spacing: 0.25rem;

  --sidebar-primary-border: hsl(var(--sidebar-primary));
  --sidebar-accent-border: hsl(var(--sidebar-accent));
  --primary-border: hsl(var(--primary));
  --secondary-border: hsl(var(--secondary));
  --muted-border: hsl(var(--muted));
  --accent-border: hsl(var(--accent));
  --destructive-border: hsl(var(--destructive));
}

.dark {
  color-scheme: dark;
}

@layer base {
  * {
    @apply border-border;
  }

  html {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }

  body {
    @apply bg-background text-foreground font-sans;
    min-height: 100dvh;
  }

  button,
  a,
  input,
  textarea,
  select {
    transition:
      color 160ms ease,
      background-color 160ms ease,
      border-color 160ms ease,
      opacity 160ms ease,
      transform 160ms ease;
  }
}

@layer utilities {
  .glass-panel {
    background:
      linear-gradient(180deg, hsl(var(--card) / 0.96), hsl(var(--card) / 0.86)),
      radial-gradient(circle at 0 0, hsl(var(--primary) / 0.12), transparent 34rem);
  }

  .command-grid {
    background-image:
      linear-gradient(hsl(var(--foreground) / 0.035) 1px, transparent 1px),
      linear-gradient(90deg, hsl(var(--foreground) / 0.035) 1px, transparent 1px);
    background-size: 32px 32px;
  }

  .hover-elevate:not(.no-default-hover-elevate),
  .active-elevate:not(.no-default-active-elevate),
  .hover-elevate-2:not(.no-default-hover-elevate),
  .active-elevate-2:not(.no-default-active-elevate) {
    position: relative;
    z-index: 0;
  }

  .hover-elevate:not(.no-default-hover-elevate)::after,
  .active-elevate:not(.no-default-active-elevate)::after,
  .hover-elevate-2:not(.no-default-hover-elevate)::after,
  .active-elevate-2:not(.no-default-active-elevate)::after {
    content: "";
    pointer-events: none;
    position: absolute;
    inset: 0;
    border-radius: inherit;
    z-index: -1;
  }

  .hover-elevate:hover:not(.no-default-hover-elevate)::after,
  .active-elevate:active:not(.no-default-active-elevate)::after {
    background-color: var(--elevate-1);
  }

  .hover-elevate-2:hover:not(.no-default-hover-elevate)::after,
  .active-elevate-2:active:not(.no-default-active-elevate)::after {
    background-color: var(--elevate-2);
  }
}
