// Hardware compatibility checker, shared logic (no DOM/Node APIs).
// It compares a user's selected parts against the real, documented benchmark runs of the
// tracked projects and never invents performance figures: FPS estimates are only shown when a
// benchmark on comparable hardware exists.

export const VERDICT = {
    tested: 'tested',
    likely: 'likely',
    partial: 'partial',
    untested: 'untested',
    incompatible: 'incompatible',
};

const ORDER = { tested: 0, likely: 1, partial: 2, untested: 3, incompatible: 4 };

const vendorName = (id, gpus) => {
    const v = gpus.find((g) => g.id === id);
    return v ? v.name : id;
};

/**
 * Evaluate a selection against the hardware config.
 * @param {{os:string, resolution:string, gpu:string, vram:number, ram:number}} sel
 * @param {{gpus:Array, resolutions:Array, benchmarks:Array}} cfg
 * @returns {{rows:Array, warnings:Array}}
 */
export function evaluate(sel, cfg) {
    const gpus = cfg.gpus || [];
    const resMap = new Map((cfg.resolutions || []).map((r) => [r.id, r]));
    const userGpu = gpus.find((g) => g.id === sel.gpu);
    const userVendor = userGpu?.vendor;
    const userRes = resMap.get(sel.resolution) || { scale: 1 };

    const rows = (cfg.benchmarks || []).map((b) => {
        const bg = gpus.find((g) => g.id === b.gpu);
        const vendorMatch = !!userVendor && !!bg && bg.vendor === userVendor;
        const vramOK = !bg || sel.vram >= b.gpuVram;
        const ramOK = sel.ram >= b.ram;
        const osOk = sel.os === b.os;

        let verdict;
        let reason = null;
        let fps = null;

        if (b.vendorOnly && !vendorMatch) {
            verdict = VERDICT.incompatible;
            reason = { key: 'notOnVendor', vendor: b.vendorOnly };
        } else if (vendorMatch && vramOK && ramOK) {
            if (osOk) {
                verdict = VERDICT.tested;
            } else {
                verdict = VERDICT.likely;
                reason = { key: 'osDiff', os: b.os };
            }
            if (b.fps) fps = b.fps;
        } else if (vendorMatch && !vramOK) {
            verdict = VERDICT.partial;
            reason = { key: 'belowVram', vram: b.gpuVram };
        } else if (vendorMatch && !ramOK) {
            verdict = VERDICT.partial;
            reason = { key: 'needRam', ram: b.ram };
        } else {
            verdict = VERDICT.untested;
            reason = { key: 'vendorDiff' };
        }

        return {
            build: b.build,
            project: b.project,
            verdict,
            reason,
            fps,
            verified: !!b.verified,
            stability: b.stability,
            notes: b.notes,
            source: b.source,
            gpuName: bg ? bg.name : null,
            gpuVram: b.gpuVram,
            ram: b.ram,
            os: b.os,
            resolution: b.resolution,
            resScale: userRes.scale,
            render: b.render,
        };
    });

    rows.sort(
        (a, b) =>
            ORDER[a.verdict] - ORDER[b.verdict] || (b.fps ? b.fps.max : -1) - (a.fps ? a.fps.max : -1),
    );

    const warnings = [];
    if (typeof sel.ram === 'number' && sel.ram < 22) warnings.push({ key: 'ramWarn' });

    return { rows, warnings };
}

export { vendorName };
