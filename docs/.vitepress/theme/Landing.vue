<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { withBase } from 'vitepress'
import Showcase from './Showcase.vue'
import activity from '../../assets/screenshots/activity.png'
import composerQueue from '../../assets/screenshots/composer-queue.png'
import deepResearch from '../../assets/screenshots/deep-research.png'
import gitReview from '../../assets/screenshots/git-review.png'
import terminal from '../../assets/screenshots/terminal.png'
import traceWorkspace from '../../assets/screenshots/trace-workspace.png'
import workbench from '../../assets/screenshots/workbench.png'

const root = ref(null)
const ready = ref(false)
const reduced = ref(false)
let observer

const views = [
  {
    key: 'session',
    label: 'Session',
    image: workbench,
    alt: 'A pi session transcript in Leyline with tool activity and a follow-up composer',
    caption: 'Read the live transcript and send a follow-up from the same window.',
  },
  {
    key: 'research',
    label: 'Research',
    image: deepResearch,
    alt: 'A Leyline research report with numbered citations and a sources panel',
    caption: 'Run research threads in parallel and read their sources alongside the report.',
  },
  {
    key: 'tracing',
    label: 'Tracing',
    image: traceWorkspace,
    alt: 'Elune tracing workspace with a run timeline and selected observation details',
    caption: 'Inspect recorded model and tool calls, with timing and usage.',
  },
  {
    key: 'terminal',
    label: 'Terminal',
    image: terminal,
    alt: 'A PTY-backed terminal drawer open below a Leyline session',
    caption: 'Open a shell in the active project without leaving the session.',
  },
]

const capabilities = [
  { title: 'Memory', text: 'Inspect and edit global, project, and session memory.' },
  { title: 'Subagents', text: 'Choose which models child agents use for delegated tasks.' },
  { title: 'Tracing', text: 'Record runs, then inspect model calls, tools, and usage.' },
  { title: 'Images and vision', text: 'Attach images, or let a vision model describe them.' },
  { title: 'Models and MCP', text: 'Configure providers, custom models, and MCP servers.' },
  { title: 'Backend connections', text: 'Connect a window to another Leyline backend.' },
  { title: 'Export', text: 'Save a session transcript as an HTML file.' },
  { title: 'Mobile layout', text: 'Use the same workspace from a phone.' },
]

const installCommands = [
  'git clone https://github.com/spmurrayzzz/leyline.git',
  'cd leyline && npm install',
  'npm run dev',
]
const installText = installCommands.join('\n')

const docLinks = [
  { text: 'Getting started', href: '/getting-started/' },
  { text: 'Installation', href: '/getting-started/installation' },
  { text: 'Linux app', href: '/getting-started/linux-installation' },
  { text: 'User guide', href: '/user-guide/' },
  { text: 'Motivations', href: '/motivations' },
  { text: 'Architecture', href: '/developer-guide/architecture' },
  { text: 'Integrations', href: '/integrations/' },
  { text: 'API reference', href: '/reference/api' },
]

const copied = ref(false)
let copyTimer

async function copyInstall() {
  try {
    await navigator.clipboard.writeText(installText)
  } catch {
    return
  }
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
  }, 1800)
}

onMounted(() => {
  reduced.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced.value || !('IntersectionObserver' in window)) {
    reduced.value = true
    return
  }

  ready.value = true

  const targets = root.value?.querySelectorAll('.reveal')
  if (!targets?.length) return

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
  )

  for (const target of targets) observer.observe(target)
})

onUnmounted(() => {
  observer?.disconnect()
  clearTimeout(copyTimer)
})
</script>

<template>
  <div
    ref="root"
    class="landing"
    :class="{ 'reveal-ready': ready, 'reveal-all': reduced }"
  >
    <section class="hero">
      <div class="hero-grid" aria-hidden="true" />

      <div class="hero-layout">
        <div class="hero-inner">
          <h1 class="hero-title">Leyline</h1>
          <p class="hero-sub">
            A workspace that runs your pi sessions in a browser or desktop
            window. Steer a run while it works, then read the transcript and
            tool calls.
          </p>
          <div class="hero-actions">
            <a class="button button-primary" :href="withBase('/getting-started/')">
              Get started
            </a>
            <a class="button button-quiet" :href="withBase('/user-guide/')">
              User guide
            </a>
          </div>
        </div>

        <div class="hero-showcase">
          <Showcase :items="views" />
        </div>
      </div>
    </section>

    <section class="band reveal">
      <div class="band-copy">
        <p class="band-label">Sessions</p>
        <h2>See which sessions need attention.</h2>
        <p>
          Pin sessions in the project sidebar and open child runs from their
          parent. Activity shows work in other sessions without switching away.
        </p>
      </div>
      <figure class="band-shot">
        <img
          :src="activity"
          alt="Activity panel listing a failed session, a running session, and a queued session"
          loading="lazy"
          decoding="async"
        />
      </figure>
    </section>

    <section class="band band-flip reveal">
      <div class="band-copy">
        <p class="band-label">Composer</p>
        <h2>Send the next task before this one ends.</h2>
        <p>
          Steer the active run or queue a task for later. Edit queued tasks before
          they run, or stop one session without stopping the others.
        </p>
      </div>
      <figure class="band-shot band-shot-strip">
        <img
          :src="composerQueue"
          alt="Composer with two queued Up next tasks above the prompt field"
          loading="lazy"
          decoding="async"
        />
      </figure>
    </section>

    <section class="band reveal">
      <div class="band-copy">
        <p class="band-label">Git review</p>
        <h2>Read diffs beside the conversation.</h2>
        <p>
          Inspect staged changes, working-tree changes, and untracked files.
          The change summary updates while the agent runs.
        </p>
      </div>
      <figure class="band-shot">
        <img
          :src="gitReview"
          alt="Git review pane showing changed files and unified diffs beside a session"
          loading="lazy"
          decoding="async"
        />
      </figure>
    </section>

    <section class="caps">
      <h2 class="reveal">Also in the workspace</h2>
      <ul class="caps-grid">
        <li
          v-for="(cap, index) in capabilities"
          :key="cap.title"
          class="cap reveal"
          :style="{ '--reveal-delay': `${index * 45}ms` }"
        >
          <h3>{{ cap.title }}</h3>
          <p>{{ cap.text }}</p>
        </li>
      </ul>
      <p class="caps-note reveal">
        Trace capture starts on for new runs. Traces stay on the selected backend
        and can contain private prompts and tool results.
      </p>
    </section>

    <section class="cta reveal">
      <h2>Run Leyline locally.</h2>
      <p>
        Use the commands below to start the dev server.
        Leyline reads your existing pi configuration and sessions.
      </p>
      <div class="install">
        <pre><code>{{ installText }}</code></pre>
        <button
          class="copy"
          type="button"
          :data-copied="copied"
          @click="copyInstall"
        >
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <ul class="cta-links">
        <li v-for="link in docLinks" :key="link.text">
          <a :href="withBase(link.href)">{{ link.text }}</a>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.landing {
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --page: 1180px;
  position: relative;
  overflow-x: clip;
}

.hero {
  position: relative;
  padding: calc(var(--vp-nav-height) + 72px) 0 0;
}

.hero-grid {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgb(255 255 255 / 3.4%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 3.4%) 1px, transparent 1px);
  background-size: 62px 62px;
  -webkit-mask-image: radial-gradient(
    860px 540px at 50% 4%,
    #000 6%,
    transparent 76%
  );
  mask-image: radial-gradient(
    860px 540px at 50% 4%,
    #000 6%,
    transparent 76%
  );
}

.hero-inner {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 840px;
  margin: 0 auto;
  text-align: center;
}

.hero-layout {
  position: relative;
  z-index: 1;
  display: grid;
  max-width: var(--page);
  margin: 0 auto;
  padding: 0 24px;
}

.hero-title {
  margin: 0;
  color: #f5f5f5;
  font-size: clamp(2.75rem, 9vw, 5.25rem);
  font-weight: 700;
  letter-spacing: -0.033em;
  line-height: 1.05;
  animation: rise 720ms var(--ease-out) both;
}

.hero-sub {
  margin: 22px auto 0;
  max-width: 640px;
  color: #a6a6a6;
  font-size: 1.0625rem;
  line-height: 1.68;
  text-wrap: pretty;
  animation: rise 720ms var(--ease-out) 90ms both;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 34px;
  animation: rise 720ms var(--ease-out) 160ms both;
}

.hero-showcase {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 1120px;
  margin: 58px auto 0;
  animation: rise 900ms var(--ease-out) 230ms both;
}

@media (min-width: 1024px) and (max-height: 1120px) {
  .hero-layout {
    grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
    align-items: center;
    gap: 56px;
  }

  .hero-grid {
    -webkit-mask-image: radial-gradient(
      900px 560px at 58% 0%,
      #000 6%,
      transparent 76%
    );
    mask-image: radial-gradient(900px 560px at 58% 0%, #000 6%, transparent 76%);
  }

  .hero-inner {
    max-width: none;
    margin: 0;
    text-align: left;
  }

  .hero-title {
    font-size: clamp(3rem, 4vw, 4.25rem);
  }

  .hero-sub {
    margin: 20px 0 0;
    max-width: 450px;
    font-size: 1rem;
  }

  .hero-actions {
    justify-content: flex-start;
    margin-top: 30px;
  }

  .hero-showcase {
    max-width: none;
    margin: 0;
  }
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  padding: 0 22px;
  border: 1px solid transparent;
  border-radius: 11px;
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
  transition:
    background-color 200ms var(--ease-out),
    border-color 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}

.button:active {
  transform: translateY(1px);
}

.button-primary {
  background: #8a78ff;
  color: #fff;
}

.button-primary:hover {
  background: #9b8cff;
}

.button-quiet {
  border-color: rgb(255 255 255 / 12%);
  background: rgb(255 255 255 / 3%);
  color: #e8e8e8;
}

.button-quiet:hover {
  border-color: rgb(255 255 255 / 22%);
  background: rgb(255 255 255 / 7%);
}

.button:focus-visible,
.copy:focus-visible,
.cta-links a:focus-visible {
  outline: 2px solid #8a78ff;
  outline-offset: 2px;
}

.band {
  max-width: var(--page);
  margin: 0 auto;
  padding: 104px 24px 0;
}

.band-flip .band-copy {
  margin-left: auto;
}

.band-label {
  margin: 0 0 14px;
  color: #8a78ff;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.band-copy {
  max-width: 660px;
}

.band-copy h2 {
  margin: 0;
  color: #f2f2f2;
  font-size: clamp(1.55rem, 2.9vw, 2.1rem);
  font-weight: 600;
  letter-spacing: -0.024em;
  line-height: 1.18;
  text-wrap: balance;
}

.band-copy p {
  margin: 16px 0 0;
  color: #a1a1a1;
  font-size: 1rem;
  line-height: 1.7;
  text-wrap: pretty;
}

.band-shot {
  margin: 40px 0 0;
}

.band-shot img {
  display: block;
  width: 100%;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 15px;
  background: #101010;
  box-shadow: 0 34px 64px -34px rgb(0 0 0 / 85%);
}

.band-shot-strip img {
  max-width: 1116px;
  margin: 0 auto;
  border-radius: 13px;
}

.caps {
  max-width: var(--page);
  margin: 0 auto;
  padding: 112px 24px 0;
}

.caps h2 {
  margin: 0;
  color: #f2f2f2;
  font-size: clamp(1.45rem, 2.6vw, 1.9rem);
  font-weight: 600;
  letter-spacing: -0.022em;
}

.caps-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 34px 0 0;
  padding: 0;
  list-style: none;
}

.cap {
  padding: 20px;
  border: 1px solid rgb(255 255 255 / 7%);
  border-radius: 13px;
  background: #131313;
  transition:
    transform 280ms var(--ease-out),
    border-color 280ms var(--ease-out),
    background-color 280ms var(--ease-out);
}

.cap:hover {
  transform: translateY(-2px);
  border-color: rgb(138 120 255 / 34%);
  background: #161616;
}

.cap h3 {
  margin: 0;
  color: #e9e9e9;
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.cap p {
  margin: 8px 0 0;
  color: #8f8f8f;
  font-size: 0.875rem;
  line-height: 1.6;
}

.caps-note {
  margin: 22px 0 0;
  color: #767676;
  font-size: 13px;
  line-height: 1.65;
}

.cta {
  max-width: var(--page);
  margin: 0 auto;
  padding: 118px 24px 136px;
  text-align: center;
}

.cta h2 {
  margin: 0;
  color: #f2f2f2;
  font-size: clamp(1.6rem, 3vw, 2.2rem);
  font-weight: 600;
  letter-spacing: -0.024em;
}

.cta > p {
  margin: 16px auto 0;
  max-width: 560px;
  color: #a1a1a1;
  font-size: 1rem;
  line-height: 1.7;
  text-wrap: pretty;
}

.install {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px;
  max-width: 100%;
  margin-top: 30px;
  padding: 16px 16px 16px 22px;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 13px;
  background: #111;
  text-align: left;
}

.install pre {
  margin: 0;
  color: #b4b4b4;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}

.install code {
  font-family: inherit;
  font-size: inherit;
  background: transparent;
  padding: 0;
}

.copy {
  flex: none;
  align-self: center;
  padding: 8px 13px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 9px;
  background: rgb(255 255 255 / 4%);
  color: #c9c9c9;
  font-size: 12.5px;
  font-weight: 500;
  transition:
    border-color 200ms var(--ease-out),
    background-color 200ms var(--ease-out),
    color 200ms var(--ease-out);
}

.copy:hover {
  border-color: rgb(255 255 255 / 20%);
  background: rgb(255 255 255 / 8%);
  color: #fff;
}

.copy[data-copied='true'] {
  border-color: rgb(138 120 255 / 42%);
  color: #c6bdff;
}

.cta-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin: 40px 0 0;
  padding: 0;
  list-style: none;
}

.cta-links a {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border: 1px solid rgb(255 255 255 / 7%);
  border-radius: 999px;
  color: #a5a5a5;
  font-size: 13px;
  text-decoration: none;
  transition:
    border-color 200ms var(--ease-out),
    color 200ms var(--ease-out);
}

.cta-links a:hover {
  border-color: rgb(255 255 255 / 18%);
  color: #ececec;
}

.reveal {
  transition:
    opacity 640ms var(--ease-out) var(--reveal-delay, 0ms),
    transform 640ms var(--ease-out) var(--reveal-delay, 0ms);
}

.reveal-ready:not(.reveal-all) .reveal {
  opacity: 0;
  transform: translateY(20px);
}

.reveal-ready:not(.reveal-all) .reveal.is-visible {
  opacity: 1;
  transform: none;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 1023px) {
  .caps-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 767px) {
  .hero {
    padding-top: calc(var(--vp-nav-height) + 44px);
  }

  .hero-sub {
    font-size: 1rem;
  }

  .hero-showcase {
    margin-top: 44px;
  }

  .hero-layout,
  .band,
  .caps,
  .cta {
    padding-right: 16px;
    padding-left: 16px;
  }

  .band {
    padding-top: 76px;
  }

  .band-shot {
    margin-top: 28px;
  }

  .caps {
    padding-top: 84px;
  }

  .cta {
    padding-top: 88px;
    padding-bottom: 104px;
  }
}

@media (max-width: 560px) {
  .caps-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .install {
    width: 100%;
    gap: 14px;
    padding: 16px 16px 14px;
  }

  .install pre {
    font-size: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-title,
  .hero-sub,
  .hero-actions,
  .hero-showcase {
    animation: none;
  }
}
</style>
