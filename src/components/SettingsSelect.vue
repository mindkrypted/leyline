<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { fuzzyScore } from '../lib/fuzzy'

const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  label: { type: String, required: true },
  placeholder: { type: String, default: 'Choose an option' },
  searchable: Boolean,
  searchPlaceholder: { type: String, default: 'Filter options' },
  disabled: Boolean,
})
const emit = defineEmits(['update:modelValue'])
const id = useId()
const trigger = ref(null)
const menu = ref(null)
const search = ref(null)
const target = ref(null)
const open = ref(false)
const query = ref('')
const activeIndex = ref(-1)
const menuStyle = ref({})
const selected = computed(() => props.options.find((option) => option.value === props.modelValue))
const filtered = computed(() => {
  if (!props.searchable || !query.value.trim()) return props.options
  return props.options
    .map((option) => ({ option, score: fuzzyScore(`${option.label} ${option.description || ''} ${option.value}`, query.value) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.option)
})
const activeId = computed(() => open.value && activeIndex.value >= 0 ? `${id}-option-${activeIndex.value}` : undefined)

watch(() => [props.disabled, props.modelValue], () => {
  close(menu.value?.contains(document.activeElement))
}, { flush: 'sync' })
watch(filtered, (options, previous) => {
  const activeValue = previous?.[activeIndex.value]?.value ?? props.modelValue
  activeIndex.value = options.findIndex((option) => !option.disabled && option.value === activeValue)
  if (activeIndex.value < 0) activeIndex.value = options.findIndex((option) => !option.disabled && option.value === props.modelValue)
  if (activeIndex.value < 0) activeIndex.value = options.findIndex((option) => !option.disabled)
  if (open.value) nextTick(scrollActive)
})
onBeforeUnmount(() => close())

function listen(add) {
  const method = add ? 'addEventListener' : 'removeEventListener'
  document[method]('pointerdown', outside, true)
  document[method]('scroll', onScroll, true)
  window[method]('resize', position)
  window.visualViewport?.[method]('resize', position)
  window.visualViewport?.[method]('scroll', position)
}

function focusTrigger() {
  if (trigger.value?.isConnected) trigger.value.focus({ preventScroll: true })
}

function close(restore = false) {
  if (!open.value) return
  open.value = false
  listen(false)
  query.value = ''
  if (restore) focusTrigger()
}

async function show(focusSearch = false, edge = '') {
  if (props.disabled || open.value) return
  focusTrigger()
  target.value = trigger.value.closest('.global-settings-modal, .context-settings-drawer, [role="dialog"]') || document.body
  menuStyle.value = { visibility: 'hidden' }
  open.value = true
  activeIndex.value = filtered.value.findIndex((option) => !option.disabled && option.value === props.modelValue)
  if (activeIndex.value < 0) activeIndex.value = filtered.value.findIndex((option) => !option.disabled)
  if (edge) move(edge)
  listen(true)
  await nextTick()
  if (!open.value) return
  position()
  await nextTick()
  if (!open.value) return
  if (props.searchable && focusSearch) search.value?.focus({ preventScroll: true })
  scrollActive()
}

function toggle(event) {
  if (props.disabled) return
  if (open.value) return close(true)
  const focusSearch = event.detail === 0 || (event.pointerType !== 'touch'
    && !window.matchMedia('(hover: none), (pointer: coarse)').matches)
  show(focusSearch)
}

function position() {
  if (!open.value || !menu.value || !trigger.value?.isConnected) return
  const anchor = trigger.value.getBoundingClientRect()
  const viewport = window.visualViewport
  const bounds = target.value === document.body ? null : target.value.getBoundingClientRect()
  const left = Math.max(viewport?.offsetLeft || 0, bounds?.left || 0) + 8
  const top = Math.max(viewport?.offsetTop || 0, bounds?.top || 0) + 8
  const right = Math.min((viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth), bounds?.right ?? Infinity) - 8
  const bottom = Math.min((viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight), bounds?.bottom ?? Infinity) - 8
  const below = bottom - anchor.bottom - 6
  const above = anchor.top - top - 6
  const upwards = below < 260 && above > below
  const height = Math.min(310, upwards ? above : below)
  if (height < 80 || right - left < 80 || anchor.bottom < top || anchor.top > bottom) return close(true)
  const width = Math.min(Math.max(anchor.width, 320), right - left)
  const parent = menu.value.offsetParent
  const parentRect = parent?.getBoundingClientRect()
  const positionedParent = parent && (parent !== document.body || getComputedStyle(parent).position !== 'static')
  const originX = positionedParent ? parentRect.left + parent.clientLeft - parent.scrollLeft : -window.scrollX
  const originY = positionedParent ? parentRect.top + parent.clientTop - parent.scrollTop : -window.scrollY
  menuStyle.value = {
    left: `${Math.max(left, Math.min(anchor.right - width, right - width)) - originX}px`,
    top: `${(upwards ? anchor.top - 6 : anchor.bottom + 6) - originY}px`,
    width: `${width}px`,
    maxHeight: `${height}px`,
    transform: upwards ? 'translateY(-100%)' : undefined,
  }
}

function outside(event) {
  if (!trigger.value?.contains(event.target) && !menu.value?.contains(event.target)) {
    close(menu.value?.contains(document.activeElement))
  }
}

function onScroll(event) {
  if (!menu.value?.contains(event.target)) close(menu.value?.contains(document.activeElement))
}

function onFocusout(event) {
  if (!trigger.value?.contains(event.relatedTarget) && !menu.value?.contains(event.relatedTarget)) close()
}

function scrollActive() {
  if (open.value && menu.value?.style.visibility !== 'hidden') {
    document.getElementById(activeId.value)?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }
}

function move(direction) {
  const options = filtered.value
  const step = direction === 'ArrowUp' || direction === 'End' ? -1 : 1
  let index = direction === 'Home' ? -1 : direction === 'End' ? options.length : activeIndex.value
  for (let count = 0; count < options.length; count++) {
    index = (index + step + options.length) % options.length
    if (!options[index].disabled) {
      activeIndex.value = index
      nextTick(scrollActive)
      return
    }
  }
}

function select(option) {
  if (!option || option.disabled || props.disabled) return
  close(true)
  emit('update:modelValue', option.value)
}

function onKeydown(event) {
  if (event.isComposing || props.disabled) return
  if (event.target === search.value && ['Home', 'End'].includes(event.key)) return
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    close(true)
  } else if (event.key === 'Tab' && open.value) {
    close(true)
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    if (open.value) {
      if (props.searchable) search.value?.focus({ preventScroll: true })
      move(event.key)
    } else show(true, ['Home', 'End'].includes(event.key) ? event.key : '')
  } else if (open.value && (event.key === 'Enter' || (event.key === ' ' && !props.searchable))) {
    event.preventDefault()
    select(filtered.value[activeIndex.value])
  }
}
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="settings-select-trigger"
    :role="searchable ? undefined : 'combobox'"
    :aria-label="`${label}: ${selected?.label || placeholder}`"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="open ? `${id}-listbox` : undefined"
    :aria-activedescendant="!searchable ? activeId : undefined"
    :aria-disabled="disabled || undefined"
    :tabindex="disabled ? -1 : 0"
    @click="toggle"
    @keydown="onKeydown"
    @focusout="onFocusout"
  >
    <span>{{ selected?.label || placeholder }}</span>
    <span class="model-caret" aria-hidden="true">▾</span>
  </button>
  <Teleport v-if="open" :to="target">
    <div
      ref="menu"
      class="model-menu settings-select-menu"
      :style="menuStyle"
      @keydown="onKeydown"
      @focusout="onFocusout"
    >
      <label v-if="searchable" class="model-search-field">
        <span aria-hidden="true">⌕</span>
        <input
          ref="search"
          v-model="query"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          :aria-controls="`${id}-listbox`"
          :aria-activedescendant="activeId"
          :aria-label="`${label}: ${searchPlaceholder}`"
          :placeholder="searchPlaceholder"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <div :id="`${id}-listbox`" class="settings-select-options" role="listbox" :aria-label="label">
        <button
          v-for="(option, index) in filtered"
          :id="`${id}-option-${index}`"
          :key="option.value"
          type="button"
          role="option"
          tabindex="-1"
          :aria-selected="option.value === modelValue"
          :aria-disabled="option.disabled || undefined"
          :disabled="option.disabled"
          :class="{ active: index === activeIndex }"
          @mousedown.prevent
          @mousemove="!option.disabled && (activeIndex = index)"
          @click="select(option)"
        >
          <span class="settings-select-option-text">
            <span>{{ option.label }}</span>
            <small v-if="option.description">{{ option.description }}</small>
          </span>
          <span class="settings-select-check" aria-hidden="true">{{ option.value === modelValue ? '✓' : '' }}</span>
        </button>
      </div>
      <div v-if="!filtered.length" class="model-menu-empty" role="status">No options match “{{ query }}”.</div>
    </div>
  </Teleport>
</template>
