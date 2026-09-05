import { ComponentType } from '#/config/IfType.js';
import IfType from '#/config/IfType.js';
import ObjType from '#/config/ObjType.js';
import Model from '#/dash3d/Model.js';

export type RefPlayerInv = {
    gender: number;
    appearance: number[];
    x: number;
    z: number;
    yaw: number;
};

type ObjSnap = {
    id: number;
    name: string;
    model: number;
    recol_s: number[];
    recol_d: number[];
    iop: (string | null)[];
    manwear: number;
    womanwear: number;
    manwearOffset: number;
    womanwearOffset: number;
    manwear2: number;
    womanwear2: number;
    xan2d: number;
    yan2d: number;
    zan2d: number;
    zoom2d: number;
    xof2d: number;
    yof2d: number;
};

type SlotItem = {
    comId: number;
    slot: number;
    count: number;
    kind: string;
    snap: ObjSnap;
};

type DumpModel = {
    modelId: number;
    points: number;
    faces: number;
    x: Int32Array;
    y: Int32Array;
    z: Int32Array;
    a: Int32Array;
    b: Int32Array;
    c: Int32Array;
    hsl: Int32Array | null;
};

function hslToRgb(hsl: number): [number, number, number] {
    const h = ((hsl >> 10) & 0x3f) / 64;
    const s = ((hsl >> 7) & 0x7) / 8;
    const l = (hsl & 0x7f) / 128;
    if (s <= 0.001) {
        return [l, l, l];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

function hue2rgb(p: number, q: number, t: number): number {
    let u = t;
    if (u < 0) {
        u += 1;
    }
    if (u > 1) {
        u -= 1;
    }
    if (u < 1 / 6) {
        return p + (q - p) * 6 * u;
    }
    if (u < 1 / 2) {
        return q;
    }
    if (u < 2 / 3) {
        return p + (q - p) * (2 / 3 - u) * 6;
    }
    return p;
}

function rgbLine(hsl: number): string {
    const [r, g, b] = hslToRgb(hsl);
    return `hsl=${hsl} rgb=${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)}`;
}

function iopLine(iop: (string | null)[]): string {
    return [0, 1, 2, 3, 4].map(i => iop[i] ?? '-').join(',');
}

function snapshotObj(id: number): ObjSnap | null {
    try {
        const obj = ObjType.list(id);
        return {
            id: obj.id,
            name: obj.name ?? '',
            model: obj.model,
            recol_s: obj.recol_s ? Array.from(obj.recol_s) : [],
            recol_d: obj.recol_d ? Array.from(obj.recol_d) : [],
            iop: obj.iop ? [0, 1, 2, 3, 4].map(i => obj.iop![i] ?? null) : [null, null, null, null, null],
            manwear: obj.manwear,
            womanwear: obj.womanwear,
            manwearOffset: obj.manwearOffset,
            womanwearOffset: obj.womanwearOffset,
            manwear2: obj.manwear2,
            womanwear2: obj.womanwear2,
            xan2d: obj.xan2d,
            yan2d: obj.yan2d,
            zan2d: obj.zan2d,
            zoom2d: obj.zoom2d,
            xof2d: obj.xof2d,
            yof2d: obj.yof2d
        };
    } catch {
        return null;
    }
}

const PLAYER_INV_COM = 3214;
const PLAYER_WORN_COM = 1688;

function collectFromCom(comId: number, kind: string): SlotItem[] {
    const com = IfType.list[comId];
    if (!com || com.type !== ComponentType.TYPE_INV || !com.linkObjType) {
        return [];
    }
    const out: SlotItem[] = [];
    const n = com.linkObjType.length;
    for (let slot = 0; slot < n; slot++) {
        const id = com.linkObjType[slot] - 1;
        if (id < 0) {
            continue;
        }
        const snap = snapshotObj(id);
        if (!snap) {
            continue;
        }
        out.push({
            comId: com.id,
            slot,
            count: com.linkObjNumber?.[slot] ?? 1,
            kind,
            snap
        });
    }
    return out;
}

function collectSlots(): SlotItem[] {
    return [...collectFromCom(PLAYER_INV_COM, 'inv'), ...collectFromCom(PLAYER_WORN_COM, 'worn')];
}

function addAppearanceWorn(slots: SlotItem[], player: RefPlayerInv | null): SlotItem[] {
    if (!player) {
        return slots;
    }
    const value = player.appearance[3] ?? 0;
    if (value < 512) {
        return slots;
    }
    const id = value - 512;
    if (slots.some(s => s.kind === 'worn' && s.snap.id === id)) {
        return slots;
    }
    const snap = snapshotObj(id);
    if (!snap) {
        return slots;
    }
    slots.push({ comId: -1, slot: 3, count: 1, kind: 'worn', snap });
    return slots;
}

function loadUnlit(item: SlotItem, player: RefPlayerInv | null): DumpModel | null {
    const gender = player?.gender ?? 0;
    const modelId = item.kind === 'worn' ? (gender === 1 ? item.snap.womanwear : item.snap.manwear) : item.snap.model;
    if (modelId < 0) {
        return null;
    }
    try {
        const model = Model.load(modelId);
        const hsl = model.faceColour ? Int32Array.from(model.faceColour) : null;
        if (hsl) {
            for (let i = 0; i < item.snap.recol_s.length; i++) {
                const src = item.snap.recol_s[i];
                const dst = item.snap.recol_d[i];
                for (let f = 0; f < hsl.length; f++) {
                    if (hsl[f] === src) {
                        hsl[f] = dst;
                    }
                }
            }
        }
        return {
            modelId,
            points: model.numPoints,
            faces: model.numFaces,
            x: model.pointX,
            y: model.pointY,
            z: model.pointZ,
            a: model.faceVertexA,
            b: model.faceVertexB,
            c: model.faceVertexC,
            hsl
        };
    } catch {
        return null;
    }
}

function dumpComLine(com: IfType | undefined): string | null {
    if (!com) {
        return null;
    }
    const scripts = com.scripts
        ? com.scripts
              .filter(s => s !== null)
              .map((s, i) => `script${i}=${[...s!].join(',')}`)
              .join(' ')
        : '';
    return `com id=${com.id} type=${com.type} clientCode=${com.clientCode} size=${com.width}x${com.height} iop=${iopLine(com.iop ?? [])} ${scripts}`.trim();
}

function dumpComs(lines: string[]): void {
    let n = 0;
    for (const comId of [PLAYER_INV_COM, PLAYER_WORN_COM]) {
        const line = dumpComLine(IfType.list[comId]);
        if (!line) {
            continue;
        }
        n++;
        lines.push(line);
    }
    if (n === 0) {
        lines.push('com (none)');
    }
}

export function buildInvVerts(player: RefPlayerInv | null): string {
    const lines: string[] = ['INV-VERTS'];
    const slots = addAppearanceWorn(collectSlots(), player);
    if (slots.length === 0) {
        lines.push('(none)');
        return lines.join('\n') + '\n';
    }
    for (const item of slots) {
        const loaded = loadUnlit(item, player);
        if (!loaded) {
            lines.push(`item slot=${item.slot} id=${item.snap.id} name=${item.snap.name} kind=${item.kind} model=- points=0 faces=0`);
            continue;
        }
        lines.push(
            `item slot=${item.slot} id=${item.snap.id} name=${item.snap.name} kind=${item.kind} model=${loaded.modelId} points=${loaded.points} faces=${loaded.faces}`
        );
        for (let i = 0; i < loaded.points; i++) {
            lines.push(`v ${i} ${loaded.x[i]} ${loaded.y[i]} ${loaded.z[i]}`);
        }
        for (let i = 0; i < loaded.faces; i++) {
            const hsl = loaded.hsl ? loaded.hsl[i] : -1;
            lines.push(`f ${i} ${loaded.a[i]} ${loaded.b[i]} ${loaded.c[i]} ${hsl}`);
        }
    }
    return lines.join('\n') + '\n';
}

export function buildInvColors(player: RefPlayerInv | null): string {
    const lines: string[] = ['INV-COLORS'];
    const slots = addAppearanceWorn(collectSlots(), player);
    if (slots.length === 0) {
        lines.push('(none)');
        return lines.join('\n') + '\n';
    }
    const seen = new Set<string>();
    for (const item of slots) {
        const key = `${item.kind}:${item.snap.id}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        lines.push(`obj id=${item.snap.id} name=${item.snap.name} kind=${item.kind}`);
        if (item.snap.recol_s.length === 0) {
            lines.push('recol (none)');
        } else {
            for (let i = 0; i < item.snap.recol_s.length; i++) {
                const src = item.snap.recol_s[i];
                const dst = item.snap.recol_d[i];
                lines.push(`recol ${src} -> ${dst} src ${rgbLine(src)} dst ${rgbLine(dst)}`);
            }
        }
        const loaded = loadUnlit(item, player);
        if (!loaded || !loaded.hsl) {
            lines.push('faces (none)');
            continue;
        }
        const unique = new Map<number, number>();
        for (let i = 0; i < loaded.faces; i++) {
            const hsl = loaded.hsl[i];
            unique.set(hsl, (unique.get(hsl) ?? 0) + 1);
        }
        const keys = [...unique.keys()].sort((a, b) => a - b);
        for (const hsl of keys) {
            lines.push(`face n=${unique.get(hsl)} ${rgbLine(hsl)}`);
        }
    }
    return lines.join('\n') + '\n';
}

export function buildModelCallbacks(player: RefPlayerInv | null): string {
    const lines: string[] = ['MODEL-CALLBACKS'];
    lines.push('pipeline icon=getModelLit+objRender worn=getWearModel+combineForAnim slot=3');
    const slots = addAppearanceWorn(collectSlots(), player);
    dumpComs(lines);
    const seen = new Set<number>();
    if (slots.length === 0) {
        lines.push('obj (none)');
        return lines.join('\n') + '\n';
    }
    for (const item of slots) {
        if (seen.has(item.snap.id)) {
            continue;
        }
        seen.add(item.snap.id);
        const o = item.snap;
        const wearable = o.manwear >= 0 || o.womanwear >= 0 ? 1 : 0;
        lines.push(
            `obj id=${o.id} name=${o.name} iop=${iopLine(o.iop)} wearable=${wearable} manwear=${o.manwear} womanwear=${o.womanwear} manwearOffset=${o.manwearOffset} womanwearOffset=${o.womanwearOffset} model=${o.model}`
        );
    }
    return lines.join('\n') + '\n';
}

export function buildEquipAlign(player: RefPlayerInv | null): string {
    const lines: string[] = ['EQUIP-ALIGN'];
    if (player) {
        const right = player.appearance[3] ?? 0;
        const wornId = right >= 512 ? right - 512 : -1;
        lines.push(
            `player x=${player.x} z=${player.z} yaw=${player.yaw} gender=${player.gender} appearance3=${right} wornId=${wornId}`
        );
    } else {
        lines.push('player (none)');
    }
    const slots = addAppearanceWorn(collectSlots(), player);
    if (slots.length === 0) {
        lines.push('(none)');
        return lines.join('\n') + '\n';
    }
    const seen = new Set<number>();
    for (const item of slots) {
        if (seen.has(item.snap.id)) {
            continue;
        }
        seen.add(item.snap.id);
        const o = item.snap;
        lines.push(
            `icon id=${o.id} name=${o.name} xan2d=${o.xan2d} yan2d=${o.yan2d} zan2d=${o.zan2d} zoom2d=${o.zoom2d} xof2d=${o.xof2d} yof2d=${o.yof2d}`
        );
        lines.push(
            `worn id=${o.id} manwear=${o.manwear} womanwear=${o.womanwear} manwearOffset=${o.manwearOffset} womanwearOffset=${o.womanwearOffset} manwear2=${o.manwear2} womanwear2=${o.womanwear2}`
        );
    }
    return lines.join('\n') + '\n';
}
