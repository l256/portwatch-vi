import { evaluate } from './hardware.js';
import { esc } from './news-shared.js';
import { t, tr } from './i18n.js';
import { STABILITY } from './scoring.js';

const $ = (sel) => document.querySelector(sel);

const VENDORS = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' };

const REASONS = {
    notOnVendor: (r) => t('hw.notOnVendor', { vendor: r.vendor }),
    osDiff: (r) => t('hw.osDiff', { os: r.os }),
    belowVram: (r) => t('hw.belowVram', { vram: r.vram }),
    needRam: (r) => t('hw.needRam', { ram: r.ram }),
    vendorDiff: () => t('hw.vendorDiff'),
};

const WARNINGS = {
    ramWarn: () => t('hw.ramWarn'),
};

const stabLabel = (k) => tr(`stab.${k}`, (STABILITY[k] || STABILITY.unknown).label);

const VERDICT_TXT = {
    tested: () => t('hw.tested'),
    likely: () => t('hw.likely'),
    partial: () => t('hw.partial'),
    untested: () => t('hw.untested'),
    incompatible: () => t('hw.incompatible'),
};

export function initHardware(cfg) {
    if (!cfg || !cfg.gpus || !cfg.benchmarks) return;

    const osSel = $('#hw-os');
    const resSel = $('#hw-res');
    const gpuSel = $('#hw-gpu');
    const ramSel = $('#hw-ram');
    const root = $('#hw-results');
    if (!osSel || !resSel || !gpuSel || !ramSel || !root) return;

    osSel.innerHTML = cfg.os.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
    resSel.innerHTML = cfg.resolutions.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('');

    const grouped = {};
    for (const g of cfg.gpus) (grouped[g.vendor] ||= []).push(g);
    gpuSel.innerHTML = Object.keys(grouped).map((vendor) =>
        `<optgroup label="${esc(VENDORS[vendor] || vendor)}">` +
        grouped[vendor].map((g) => `<option value="${esc(g.id)}">${esc(g.name)} · ${g.vram} GB</option>`).join('') +
        `</optgroup>`,
    ).join('');

    ramSel.innerHTML = cfg.rams.map((r) => `<option value="${r}">${r} GB</option>`).join('');

    osSel.value = cfg.os[0]?.id || '';
    resSel.value = cfg.resolutions[0]?.id || '';
    if (cfg.gpus.length) gpuSel.value = cfg.gpus[0].id;
    if (cfg.rams.length) ramSel.value = cfg.rams[0];

    function selection() {
        const gpu = cfg.gpus.find((g) => g.id === gpuSel.value) || {};
        return {
            os: osSel.value,
            resolution: resSel.value,
            gpu: gpuSel.value,
            vram: typeof gpu.vram === 'number' ? gpu.vram : 0,
            ram: Number(ramSel.value) || 0,
        };
    }

    const fpsTxt = (fps) => (fps ? (fps.min === fps.max ? `${fps.min} FPS` : `${fps.min}–${fps.max} FPS`) : t('hw.fpsNone'));

    function render() {
        const { rows, warnings } = evaluate(selection(), cfg);
        root.innerHTML =
            (warnings.length ? `<div class="hw-warn">${warnings.map((w) => esc(WARNINGS[w.key]())).join(' ')}</div>` : '') +
            rows.map((r) => {
                const reason = r.reason && REASONS[r.reason.key] ? REASONS[r.reason.key](r.reason) : '';
                const badges =
                    (r.verified ? `<span class="hw-badge hw-b-ok">${esc(t('hw.verified'))}</span>` : `<span class="hw-badge">${esc(t('hw.unverified'))}</span>`) +
                    (r.stability && r.stability !== 'unknown' ? `<span class="hw-badge">${esc(stabLabel(r.stability))}</span>` : '');
                const meta = [r.gpuName, r.resolution, t('hw.onRam', { ram: r.ram })].filter(Boolean).join(' · ');
                return `
        <li class="hw-row hw-v-${r.verdict}">
          <div class="hw-main">
            <strong class="hw-name">${esc(r.build)}</strong>
            <span class="hw-project">${esc(r.project || '')}</span>
            <span class="hw-meta">${esc(meta)}</span>
          </div>
          <div class="hw-side">
            <span class="hw-verdict hw-vt-${r.verdict}">${esc(VERDICT_TXT[r.verdict]())}</span>
            ${r.fps ? `<span class="hw-fps">${esc(fpsTxt(r.fps))}</span>` : ''}
            ${reason ? `<span class="hw-reason">${esc(reason)}</span>` : ''}
            ${badges ? `<span class="hw-badges">${badges}</span>` : ''}
            ${r.source ? `<a class="hw-source" href="${esc(r.source)}" target="_blank" rel="noopener noreferrer">${esc(t('hw.source'))}</a>` : ''}
          </div>
        </li>`;
            }).join('');
    }

    for (const el of [osSel, resSel, gpuSel, ramSel]) el.addEventListener('change', render);
    render();
}
