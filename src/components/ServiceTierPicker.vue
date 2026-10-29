<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

const props = defineProps({
  availableServiceTiers: { type: Array, default: () => ['standard'] },
  serviceTier: { type: String, default: 'standard' },
  disabled: Boolean,
  start: Boolean,
})

const emit = defineEmits(['select-service-tier', 'open'])
const tierLabels = { standard: 'Standard', fast: 'Fast', ultrafast: 'Ultrafast' }
const tiers = computed(() => Object.keys(tierLabels).filter(tier => props.availableServiceTiers.includes(tier)))
const root = ref(null)
const trigger = ref(null)
const opened = ref(false)
const activeIndex = ref(0)
const menuId = useId()

watch([() => props.disabled, () => props.serviceTier, () => tiers.value.join(',')], () => dismiss())
onBeforeUnmount(() => dismiss(false))

function dismiss(restoreFocus = true) {
  if (!opened.value) return false
  opened.value = false
  document.removeEventListener('pointerdown', closeOutside, true)
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
  return true
}

function closeOutside(event) {
  if (!event.composedPath().includes(root.value)) dismiss(false)
}

async function show(edge = '') {
  if (props.disabled || opened.value) return
  emit('open')
  opened.value = true
  activeIndex.value = Math.max(0, tiers.value.indexOf(props.serviceTier))
  if (edge === 'Home') activeIndex.value = 0
  if (edge === 'End') activeIndex.value = tiers.value.length - 1
  document.addEventListener('pointerdown', closeOutside, true)
  await nextTick()
  if (opened.value) trigger.value?.focus({ preventScroll: true })
}

function select(tier) {
  if (props.disabled || !tiers.value.includes(tier)) return
  dismiss()
  if (tier !== props.serviceTier) emit('select-service-tier', tier)
}

function onKeydown(event) {
  if (event.isComposing || props.disabled) return
  if (event.key === 'Escape' && opened.value) {
    event.preventDefault()
    event.stopPropagation()
    dismiss()
  } else if (event.key === 'Tab') {
    dismiss(false)
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    if (!opened.value) show(event.key)
    else if (event.key === 'Home') activeIndex.value = 0
    else if (event.key === 'End') activeIndex.value = tiers.value.length - 1
    else activeIndex.value = (activeIndex.value + (event.key === 'ArrowUp' ? -1 : 1) + tiers.value.length) % tiers.value.length
  } else if (opened.value && ['Enter', ' '].includes(event.key)) {
    event.preventDefault()
    select(tiers.value[activeIndex.value])
  }
}

function onFocusout(event) {
  if (!root.value?.contains(event.relatedTarget)) dismiss(false)
}

defineExpose({ opened, dismiss })
</script>

<template>
  <div ref="root" class="model-picker service-tier-picker" :class="{ 'start-picker': start }" @focusout="onFocusout">
    <button
      ref="trigger"
      class="composer-chip model-picker-button service-tier-chip"
      :class="{ active: serviceTier !== 'standard', 'start-composer-chip': start }"
      type="button"
      role="combobox"
      :aria-disabled="disabled"
      :tabindex="disabled ? -1 : 0"
      :aria-label="`Speed: ${tierLabels[serviceTier]}`"
      aria-haspopup="listbox"
      :aria-expanded="opened"
      :aria-controls="opened ? menuId : undefined"
      :aria-activedescendant="opened ? `${menuId}-${activeIndex}` : undefined"
      title="Fast and Ultrafast use premium pricing. Applies to this session only."
      @click="opened ? dismiss() : show()"
      @keydown="onKeydown"
    >
      <svg viewBox="0 0 8 8" aria-hidden="true">
        <circle cx="4" cy="4" r="2.5"></circle>
      </svg>
      <span>{{ serviceTier }}</span>
      <span class="model-caret" aria-hidden="true">▾</span>
    </button>
    <Transition name="composer-popover">
      <div v-if="opened" :id="menuId" class="model-menu small-menu service-tier-menu" role="listbox" aria-label="Speed">
        <button
          v-for="(tier, index) in tiers"
          :id="`${menuId}-${index}`"
          :key="tier"
          type="button"
          role="option"
          tabindex="-1"
          :aria-selected="tier === serviceTier"
          :class="{ active: index === activeIndex }"
          :title="tier === 'standard' ? 'Default service tier' : 'Premium pricing'"
          @mousedown.prevent
          @mousemove="activeIndex = index"
          @click="select(tier)"
        >
          <span>{{ tier }}</span>
          <span v-if="tier === serviceTier" aria-hidden="true">✓</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.service-tier-picker {
  flex: none;
}

.service-tier-chip.composer-chip.model-picker-button {
  width: auto;
  gap: 6px;
}

.service-tier-chip svg {
  flex: none;
  width: 8px;
  height: 8px;
  fill: none;
  stroke: currentColor;
}

.service-tier-chip.composer-chip.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: #d8d0ff;
}

.service-tier-chip.active svg {
  fill: var(--accent);
  stroke: var(--accent);
}

.service-tier-chip.composer-chip:hover:not([aria-disabled="true"]) {
  color: var(--text);
}

.service-tier-chip.composer-chip[aria-disabled="true"] {
  opacity: 0.45;
  transform: none;
}

.service-tier-chip:focus-visible {
  outline: 2px solid var(--accent-border);
  outline-offset: 2px;
}

.service-tier-menu {
  right: 0;
  bottom: calc(100% + 8px);
  left: auto;
  width: 160px;
  transform-origin: bottom right;
}

@media (hover: none), (pointer: coarse) {
  .service-tier-chip.composer-chip.model-picker-button,
  .service-tier-menu button {
    min-height: 44px;
  }
}
</style>
