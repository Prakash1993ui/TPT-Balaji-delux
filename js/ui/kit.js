/*
 * UI kit: hooks and reusable components (Preact + htm, no build step).
 *
 * Modals open as full-screen sheets on phones, centred dialogs / side drawers on
 * tablets & desktops, and integrate with the browser Back button (Android).
 */
(function (App) {
  'use strict';
  const { h, render } = window.preact;
  const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } = window.preactHooks;
  const html = window.htm.bind(h);
  const { U } = App;
  const S = App.Store;

  // ---------------------------------------------------------------- hooks
  function useStore() {
    const [, set] = useState(0);
    useEffect(() => S.subscribe((v) => set(v)), []);
    return S.version;
  }
  function useMedia(query) {
    const [m, setM] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
      const mq = window.matchMedia(query);
      const on = () => setM(mq.matches);
      if (mq.addEventListener) mq.addEventListener('change', on);
      else mq.addListener(on);
      on();
      return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
    }, [query]);
    return m;
  }
  const BP = {
    tablet: '(min-width: 700px)',
    wide: '(min-width: 900px)',
    desktop: '(min-width: 1100px)',
  };
  function useTick(ms = 60000) {
    const [, set] = useState(0);
    useEffect(() => {
      const id = setInterval(() => set((x) => x + 1), ms);
      return () => clearInterval(id);
    }, [ms]);
  }
  function usePref(key, initial) {
    const [v, setV] = useState(() => App.Meta.get('pref:' + key, initial));
    const set = useCallback((next) => {
      setV((cur) => {
        const val = typeof next === 'function' ? next(cur) : next;
        App.Meta.set('pref:' + key, val);
        return val;
      });
    }, [key]);
    return [v, set];
  }

  // ---------------------------------------------------------------- basics
  function Icon({ name, size = 20, class: c, stroke = 2 }) {
    const inner = App.ICONS[name] || App.ICONS.info;
    return html`<svg class=${U.cls('icon', c)} width=${size} height=${size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      focusable="false" dangerouslySetInnerHTML=${{ __html: inner }}></svg>`;
  }

  function Button(props) {
    const { variant = 'secondary', size, icon, iconRight, block, loading, children, class: c, disabled, ...rest } = props;
    const hasText = children != null && children !== false && children !== '';
    return html`<button type="button" ...${rest}
      class=${U.cls('btn', 'btn-' + variant, size && 'btn-' + size, block && 'btn-block', !hasText && 'btn-icon', loading && 'is-loading', c)}
      disabled=${disabled || loading}>
      ${loading ? html`<span class="spinner" aria-hidden="true"></span>` : icon && html`<${Icon} name=${icon} size=${size === 'sm' ? 16 : 18} />`}
      ${hasText && html`<span class="btn-text">${children}</span>`}
      ${iconRight && html`<${Icon} name=${iconRight} size=${16} />`}
    </button>`;
  }

  const Badge = ({ tone = 'muted', children, dot, class: c }) =>
    html`<span class=${U.cls('badge', 'tone-' + tone, c)}>${dot && html`<i class="dot"></i>`}${children}</span>`;

  const AVATAR_TONES = ['#8A1538', '#B45309', '#047857', '#1D4ED8', '#6D28D9', '#BE185D', '#0F766E', '#9A3412'];
  function Avatar({ name, size = 40 }) {
    let hash = 0;
    for (const ch of name || '') hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    const bg = AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
    return html`<span class="avatar" style=${`width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(size * 0.38)}px`}>${U.initials(name)}</span>`;
  }

  function Field({ label, hint, error, required, children, class: c, as = 'label' }) {
    const Tag = as;
    return html`<${Tag} class=${U.cls('field', error && 'has-error', c)}>
      ${label && html`<span class="field-label">${label}${required && html`<span class="req" aria-hidden="true"> *</span>`}</span>`}
      ${children}
      ${error ? html`<span class="field-error" role="alert">${error}</span>` : hint && html`<span class="field-hint">${hint}</span>`}
    <//>`;
  }

  function Input({ value, onChange, type = 'text', class: c, ...rest }) {
    return html`<input class=${U.cls('input', c)} type=${type} value=${value == null ? '' : value}
      onInput=${(e) => onChange && onChange(e.currentTarget.value)} ...${rest} />`;
  }
  function MoneyInput({ value, onChange, class: c, ...rest }) {
    return html`<div class=${U.cls('input-affix', c)}>
      <span class="affix">₹</span>
      <input class="input" type="number" inputmode="decimal" min="0" step="any" value=${value == null ? '' : value}
        onInput=${(e) => onChange(e.currentTarget.value)} onFocus=${(e) => e.currentTarget.select()} ...${rest} />
    </div>`;
  }
  function Select({ value, onChange, options, placeholder, class: c, ...rest }) {
    const opts = (options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
    return html`<div class=${U.cls('select-wrap', c)}>
      <select class="input select" value=${value == null ? '' : value} onChange=${(e) => onChange(e.currentTarget.value)} ...${rest}>
        ${placeholder != null && html`<option value="">${placeholder}</option>`}
        ${opts.map((o) => html`<option value=${o.value} disabled=${o.disabled}>${o.label}</option>`)}
      </select>
      <${Icon} name="chevronDown" size=${16} class="select-caret" />
    </div>`;
  }
  const Textarea = ({ value, onChange, rows = 3, class: c, ...rest }) =>
    html`<textarea class=${U.cls('input textarea', c)} rows=${rows} value=${value || ''} onInput=${(e) => onChange(e.currentTarget.value)} ...${rest}></textarea>`;

  function Toggle({ checked, onChange, label, hint, disabled }) {
    return html`<label class=${U.cls('toggle', disabled && 'is-disabled')}>
      <span class="toggle-text"><span class="toggle-label">${label}</span>${hint && html`<span class="toggle-hint">${hint}</span>`}</span>
      <input type="checkbox" role="switch" checked=${!!checked} disabled=${disabled} onChange=${(e) => onChange(e.currentTarget.checked)} />
      <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
    </label>`;
  }

  function Segmented({ value, onChange, options, size, class: c, full }) {
    return html`<div class=${U.cls('segmented', size && 'segmented-' + size, full && 'segmented-full', c)} role="tablist">
      ${options.map((o) => {
        const opt = typeof o === 'object' ? o : { value: o, label: o };
        const active = opt.value === value;
        return html`<button type="button" role="tab" aria-selected=${active} class=${U.cls('seg', active && 'is-active')}
          onClick=${() => onChange(opt.value)}>
          ${opt.icon && html`<${Icon} name=${opt.icon} size=${16} />`}<span>${opt.label}</span>
          ${opt.count != null && html`<span class="seg-count">${opt.count}</span>`}
        </button>`;
      })}
    </div>`;
  }

  function Stepper({ value, onChange, min = 0, max = 99, label }) {
    const v = +value || 0;
    return html`<div class="stepper" aria-label=${label}>
      <button type="button" class="stepper-btn" aria-label="Decrease" disabled=${v <= min} onClick=${() => onChange(Math.max(min, v - 1))}><${Icon} name="minus" size=${16} /></button>
      <input class="stepper-value" type="number" inputmode="numeric" value=${v} min=${min} max=${max}
        onInput=${(e) => { const n = parseInt(e.currentTarget.value, 10); if (!isNaN(n)) onChange(U.clamp(n, min, max)); }} />
      <button type="button" class="stepper-btn" aria-label="Increase" disabled=${v >= max} onClick=${() => onChange(Math.min(max, v + 1))}><${Icon} name="plus" size=${16} /></button>
    </div>`;
  }

  function SearchInput({ value, onChange, placeholder = 'Search…', autoFocus, class: c, inputRef, onKeyDown }) {
    return html`<div class=${U.cls('search', c)}>
      <${Icon} name="search" size=${18} class="search-icon" />
      <input ref=${inputRef} class="input search-input" type="search" enterkeyhint="search" placeholder=${placeholder} value=${value}
        autofocus=${autoFocus} onInput=${(e) => onChange(e.currentTarget.value)} onKeyDown=${onKeyDown} aria-label=${placeholder} />
      ${value && html`<button type="button" class="search-clear" aria-label="Clear search" onClick=${() => onChange('')}><${Icon} name="x" size=${16} /></button>`}
    </div>`;
  }

  function Chips({ options, value, onChange, multiple }) {
    const sel = multiple ? value || [] : [value];
    return html`<div class="chips">
      ${options.map((o) => {
        const opt = typeof o === 'object' ? o : { value: o, label: o };
        const on = sel.includes(opt.value);
        return html`<button type="button" class=${U.cls('chip', on && 'is-on', opt.tone && 'tone-' + opt.tone)} aria-pressed=${on}
          disabled=${opt.disabled} onClick=${() => {
            if (!multiple) return onChange(on && opt.clearable ? '' : opt.value);
            onChange(on ? sel.filter((x) => x !== opt.value) : [...sel, opt.value]);
          }}>${opt.label}${opt.count != null && html`<span class="chip-count">${opt.count}</span>`}</button>`;
      })}
    </div>`;
  }

  const Card = ({ title, subtitle, actions, children, class: c, pad = true, icon }) => html`<section class=${U.cls('card', c)}>
    ${(title || actions) && html`<header class="card-head">
      <div class="card-titles">${icon && html`<span class="card-icon"><${Icon} name=${icon} size=${18} /></span>`}<div>
        ${title && html`<h3 class="card-title">${title}</h3>`}${subtitle && html`<div class="card-subtitle">${subtitle}</div>`}</div></div>
      ${actions && html`<div class="card-actions">${actions}</div>`}
    </header>`}
    <div class=${pad ? 'card-body' : 'card-body flush'}>${children}</div>
  </section>`;

  const Stat = ({ label, value, sub, icon, tone = 'brand', onClick }) => html`<${onClick ? 'button' : 'div'} type=${onClick ? 'button' : undefined}
      class=${U.cls('stat', 'tone-' + tone, onClick && 'is-clickable')} onClick=${onClick}>
    <div class="stat-top"><span class="stat-label">${label}</span>${icon && html`<span class="stat-icon"><${Icon} name=${icon} size=${18} /></span>`}</div>
    <div class="stat-value">${value}</div>
    ${sub && html`<div class="stat-sub">${sub}</div>`}
  <//>`;

  const EmptyState = ({ icon = 'info', title, text, action }) => html`<div class="empty">
    <div class="empty-icon"><${Icon} name=${icon} size=${28} /></div>
    <div class="empty-title">${title}</div>
    ${text && html`<div class="empty-text">${text}</div>`}
    ${action && html`<div class="empty-action">${action}</div>`}
  </div>`;

  const Page = ({ title, subtitle, actions, children, class: c, toolbar }) => html`<div class=${U.cls('page', c)}>
    <div class="page-head">
      <div class="page-titles"><h1 class="page-title">${title}</h1>${subtitle && html`<p class="page-subtitle">${subtitle}</p>`}</div>
      ${actions && html`<div class="page-actions">${actions}</div>`}
    </div>
    ${toolbar && html`<div class="page-toolbar">${toolbar}</div>`}
    ${children}
  </div>`;

  const KV = ({ items }) => html`<dl class="kv">${items.filter(Boolean).map(([k, v]) => html`<div class="kv-row"><dt>${k}</dt><dd>${v == null || v === '' ? '—' : v}</dd></div>`)}</dl>`;

  // Simple responsive bar chart (HTML bars scale with the container)
  function BarChart({ data, height = 170, format = U.moneyShort, tone = 'brand', highlightLast }) {
    const max = Math.max(1, ...data.map((d) => d.value));
    const maxIdx = data.findIndex((d) => d.value === max);
    return html`<div class=${U.cls('bars', 'tone-' + tone)} style=${`--bars-h:${height}px`}>
      ${data.map((d, i) => html`<div class=${U.cls('bar-col', highlightLast && i === data.length - 1 && 'is-current', i === maxIdx && 'is-max')} title=${`${d.title || d.label}: ${format(d.value)}`}>
        <div class="bar-val">${d.value ? format(d.value) : ''}</div>
        <div class="bar-track"><div class="bar" style=${`height:${d.value > 0 ? Math.max(3, (d.value / max) * 100) : 0}%`}></div></div>
        <div class="bar-label">${d.label}</div>
      </div>`)}
    </div>`;
  }

  // ---------------------------------------------------------------- modal system
  const stack = [];
  const escStack = [];
  let modalRender = null;
  let seq = 0;
  let ignorePop = 0;
  let pendingHash = null;

  function openModal(Component, props = {}) {
    return new Promise((resolve) => {
      const entry = { id: ++seq, Component, props, resolve, pushed: false };
      stack.push(entry);
      try {
        history.pushState({ tbdModal: entry.id }, '');
        entry.pushed = true;
      } catch (e) { /* ignore (file:// in some browsers) */ }
      modalRender && modalRender();
    });
  }
  function closeModal(id, result) {
    const idx = stack.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const [entry] = stack.splice(idx, 1);
    modalRender && modalRender();
    if (entry.pushed) {
      ignorePop++;
      history.back();
    }
    entry.resolve(result);
  }
  function closeAllModals() {
    let n = 0;
    while (stack.length) {
      const m = stack.pop();
      if (m.pushed) n++;
      m.resolve(undefined);
    }
    modalRender && modalRender();
    return n;
  }
  /** Navigate to a route, closing any open modals first (keeps history tidy). */
  function navigate(hash) {
    const n = closeAllModals();
    if (n > 0) {
      ignorePop++;
      pendingHash = hash;
      history.go(-n);
    } else if (location.hash !== hash) location.hash = hash;
  }
  window.addEventListener('popstate', () => {
    if (ignorePop > 0) {
      ignorePop--;
      if (pendingHash && ignorePop === 0) {
        const hsh = pendingHash;
        pendingHash = null;
        if (location.hash !== hsh) location.hash = hsh;
      }
      return;
    }
    if (stack.length) {
      const top = stack[stack.length - 1];
      top.pushed = false; // this history entry is already gone
      closeModal(top.id, undefined);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && escStack.length) {
      e.preventDefault();
      escStack[escStack.length - 1]();
    }
  });

  function ModalHost() {
    const [, force] = useState(0);
    useEffect(() => {
      modalRender = () => force((x) => x + 1);
      return () => (modalRender = null);
    }, []);
    useEffect(() => {
      document.documentElement.classList.toggle('modal-open', stack.length > 0);
    });
    return html`${stack.map((m) => h(m.Component, Object.assign({ key: m.id }, m.props, { close: (r) => closeModal(m.id, r) })))}`;
  }

  /** Modal chrome. kind: dialog (centred) | drawer (right side on large screens) | sheet (bottom sheet). */
  function Modal({ title, subtitle, onClose, children, footer, size = 'md', kind = 'dialog', headerActions, class: c, locked, icon }) {
    const ref = useRef();
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
      const fn = () => closeRef.current && closeRef.current();
      escStack.push(fn);
      const el = ref.current;
      const auto = el && el.querySelector('[data-autofocus]');
      if (auto && window.matchMedia('(min-width: 700px)').matches) setTimeout(() => auto.focus(), 30);
      else if (el) el.focus({ preventScroll: true });
      return () => {
        const i = escStack.lastIndexOf(fn);
        if (i >= 0) escStack.splice(i, 1);
      };
    }, []);
    return html`<div class=${U.cls('modal-backdrop', 'kind-' + kind)}
        onClick=${(e) => { if (!locked && e.target === e.currentTarget) onClose && onClose(); }}>
      <div class=${U.cls('modal', 'size-' + size, c)} role="dialog" aria-modal="true" aria-label=${typeof title === 'string' ? title : undefined} tabindex="-1" ref=${ref}>
        <header class="modal-header">
          ${icon && html`<span class="modal-icon"><${Icon} name=${icon} size=${20} /></span>`}
          <div class="modal-titles"><h2 class="modal-title">${title}</h2>${subtitle && html`<div class="modal-subtitle">${subtitle}</div>`}</div>
          ${headerActions && html`<div class="modal-header-actions">${headerActions}</div>`}
          <button type="button" class="btn btn-ghost btn-icon modal-close" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button>
        </header>
        <div class="modal-body">${children}</div>
        ${footer && html`<footer class="modal-footer">${footer}</footer>`}
      </div>
    </div>`;
  }

  function ConfirmModal({ close, title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger, requireText, icon }) {
    const [txt, setTxt] = useState('');
    const ok = !requireText || txt.trim().toLowerCase() === String(requireText).toLowerCase();
    return html`<${Modal} title=${title} icon=${icon || (danger ? 'alert' : 'info')} size="sm" kind="sheet" onClose=${() => close(false)}
      class=${danger ? 'is-danger' : ''}
      footer=${html`<${Button} onClick=${() => close(false)}>${cancelText}<//>
        <${Button} variant=${danger ? 'danger' : 'primary'} disabled=${!ok} onClick=${() => close(true)} data-autofocus>${confirmText}<//>`}>
      <div class="confirm-msg">${message}</div>
      ${requireText && html`<${Field} label=${`Type "${requireText}" to confirm`}>
        <input class="input" value=${txt} onInput=${(e) => setTxt(e.currentTarget.value)} autocomplete="off" data-autofocus />
      <//>`}
    <//>`;
  }
  const confirm = (opts) => openModal(ConfirmModal, opts).then((r) => !!r);

  function ActionSheet({ close, title, actions }) {
    return html`<${Modal} title=${title} size="sm" kind="sheet" onClose=${() => close(null)}>
      <div class="action-list">
        ${actions.filter(Boolean).map((a) => html`<button type="button" class=${U.cls('action-item', a.danger && 'is-danger')} disabled=${a.disabled}
            onClick=${() => close(a.value)}>
          ${a.icon && html`<span class="action-icon"><${Icon} name=${a.icon} size=${20} /></span>`}
          <span class="action-text"><span class="action-label">${a.label}</span>${a.hint && html`<span class="action-hint">${a.hint}</span>`}</span>
          <${Icon} name="chevronRight" size=${18} class="action-chev" />
        </button>`)}
      </div>
    <//>`;
  }
  const chooseAction = (title, actions) => openModal(ActionSheet, { title, actions });

  // ---------------------------------------------------------------- toasts
  let toasts = [];
  let toastRender = null;
  let toastSeq = 0;
  function toast(message, type = 'success', opts = {}) {
    const id = ++toastSeq;
    toasts = [...toasts, { id, message, type, action: opts.action }].slice(-4);
    toastRender && toastRender();
    setTimeout(() => dismissToast(id), opts.duration || (type === 'error' ? 6500 : 3200));
  }
  function dismissToast(id) {
    toasts = toasts.filter((t) => t.id !== id);
    toastRender && toastRender();
  }
  function ToastHost() {
    const [, force] = useState(0);
    useEffect(() => {
      toastRender = () => force((x) => x + 1);
      return () => (toastRender = null);
    }, []);
    const icons = { success: 'checkCircle', error: 'circleAlert', info: 'info' };
    return html`<div class="toasts" role="status" aria-live="polite">
      ${toasts.map((t) => html`<div key=${t.id} class=${U.cls('toast', 'toast-' + t.type)}>
        <${Icon} name=${icons[t.type] || 'info'} size=${18} />
        <span class="toast-msg">${t.message}</span>
        ${t.action && html`<button type="button" class="toast-action" onClick=${() => { dismissToast(t.id); t.action.onClick(); }}>${t.action.label}</button>`}
        <button type="button" class="toast-close" aria-label="Dismiss" onClick=${() => dismissToast(t.id)}><${Icon} name="x" size=${16} /></button>
      </div>`)}
    </div>`;
  }

  /** Run an async action with error toast; returns result or undefined. */
  async function attempt(fn, okMessage) {
    try {
      const r = await fn();
      if (okMessage) toast(okMessage, 'success');
      return r;
    } catch (e) {
      console.error(e);
      toast(e && e.message ? e.message : String(e), 'error');
      return undefined;
    }
  }

  Object.assign(App, {
    h, render, html, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect,
    useStore, useMedia, useTick, usePref, BP,
    Icon, Button, Badge, Avatar, Field, Input, MoneyInput, Select, Textarea, Toggle, Segmented, Stepper, SearchInput, Chips,
    Card, Stat, EmptyState, Page, KV, BarChart,
    Modal, ModalHost, openModal, closeAllModals, navigate, confirm, chooseAction,
    ToastHost, toast, attempt,
  });
})(window.App = window.App || {});
