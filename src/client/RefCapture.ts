import { canvas } from '#/graphics/Canvas.js';

import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';
import LocType from '#/config/LocType.js';
import type ClientBuild from '#/client/ClientBuild.js';
import type World from '#/dash3d/World.js';

const INGEST = 'http://127.0.0.1:43596/capture';
const RADIUS = 12;
const MAX_TICKS = 25;
const INTERVAL_MS = 600;

export type RefDumpCtx = {
    loopCycle: number;
    wx: number;
    wz: number;
    camYaw: number;
    camPitch: number;
    mapBuildBaseX: number;
    mapBuildBaseZ: number;
    groundh: Int32Array[][] | null;
    collision: (CollisionMap | null)[];
    world: World | null;
    build: ClientBuild | null;
};

export default class RefCapture {
    static on = false;
    static session = '';
    static startWx = 0;
    static startWz = 0;
    static tick = 0;
    static warned = false;
    static busy = false;
    static lastStartedMs = 0;
    static notify: ((msg: string) => void) | null = null;

    static toggle(wx: number, wz: number, chat: (msg: string) => void): boolean {
        this.on = !this.on;
        this.notify = chat;
        if (this.on) {
            const now = new Date();
            const pad = (n: number): string => String(n).padStart(2, '0');
            this.session = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
            this.startWx = wx;
            this.startWz = wz;
            this.tick = 0;
            this.warned = false;
            this.busy = false;
            this.lastStartedMs = 0;
            chat(`ref capture on ${this.session} at ${wx},${wz} radius=${RADIUS} 25 shots @ 0.6s`);
            console.log(`ref capture on ${this.session}`);
        } else {
            chat(`ref capture off after ${this.tick} shots`);
            console.log('ref capture off');
        }
        return this.on;
    }

    static async captureTick(ctx: RefDumpCtx): Promise<void> {
        if (!this.on || this.busy) {
            return;
        }
        if (this.tick >= MAX_TICKS) {
            this.stopCap();
            return;
        }
        const now = performance.now();
        if (this.tick > 0 && now - this.lastStartedMs < INTERVAL_MS) {
            return;
        }
        this.lastStartedMs = now;
        this.busy = true;
        this.tick++;
        const dump = this.buildDump(ctx);
        const build = this.buildGodot(ctx);
        let png = '';
        try {
            png = await this.canvasPng();
        } catch (e) {
            console.warn('ref capture png failed', e);
        }
        try {
            const res = await fetch(INGEST, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: this.session,
                    tick: this.tick,
                    wx: this.startWx,
                    wz: this.startWz,
                    dump,
                    build,
                    png
                })
            });
            if (!res.ok && !this.warned) {
                this.warned = true;
                console.warn('ref capture ingest rejected', res.status);
            }
        } catch {
            if (!this.warned) {
                this.warned = true;
                console.warn('ref capture ingest down — start LostCityRef.bat');
            }
        } finally {
            this.busy = false;
        }
        if (this.on && this.tick >= MAX_TICKS) {
            this.stopCap();
        }
    }

    private static stopCap(): void {
        if (!this.on) {
            return;
        }
        this.on = false;
        this.notify?.(`ref capture off after ${this.tick} shots`);
        console.log('ref capture stopped at tick cap');
    }

    private static canvasPng(): Promise<string> {
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (!blob) {
                    reject(new Error('empty canvas'));
                    return;
                }
                const reader = new FileReader();
                reader.onloadend = () => {
                    const result = String(reader.result ?? '');
                    const comma = result.indexOf(',');
                    resolve(comma >= 0 ? result.slice(comma + 1) : result);
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            }, 'image/png');
        });
    }

    private static buildDump(ctx: RefDumpCtx): string {
        const lines: string[] = [];
        const mx = (ctx.wx >> 6) * 64;
        const mz = (ctx.wz >> 6) * 64;
        lines.push(`tile ${ctx.wx},${ctx.wz} radius=${RADIUS}`);
        lines.push(`source webclient loopCycle=${ctx.loopCycle} camYaw=${ctx.camYaw} camPitch=${ctx.camPitch}`);
        lines.push(`map ${ctx.wx >> 6}_${ctx.wz >> 6} world origin ${mx},${mz} base=${ctx.mapBuildBaseX},${ctx.mapBuildBaseZ}`);
        lines.push('');
        lines.push('TILES');
        for (let z = ctx.wz - RADIUS; z <= ctx.wz + RADIUS; z++) {
            for (let x = ctx.wx - RADIUS; x <= ctx.wx + RADIUS; x++) {
                lines.push(this.tileLine(ctx, x, z));
            }
        }
        lines.push('');
        lines.push('LOCS');
        for (let z = ctx.wz - RADIUS; z <= ctx.wz + RADIUS; z++) {
            for (let x = ctx.wx - RADIUS; x <= ctx.wx + RADIUS; x++) {
                this.appendLocs(ctx, x, z, lines);
            }
        }
        return lines.join('\n') + '\n';
    }

    private static mapsquareKeys(wx: number, wz: number): string[] {
        const keys = new Set<string>();
        for (let z = wz - RADIUS; z <= wz + RADIUS; z++) {
            for (let x = wx - RADIUS; x <= wx + RADIUS; x++) {
                const key = `${x >> 6}_${z >> 6}`;
                if (key !== '48_148') {
                    keys.add(key);
                }
            }
        }
        return [...keys].sort();
    }

    private static buildGodot(ctx: RefDumpCtx): string {
        const keys = this.mapsquareKeys(ctx.wx, ctx.wz);
        const lines: string[] = [];
        lines.push(`godot-build tile ${ctx.wx},${ctx.wz} radius=${RADIUS}`);
        lines.push(`mapsquares ${keys.join(' ')}`);
        lines.push('never 48_148');
        lines.push('');
        lines.push('EXPORT from engine/');
        for (const key of keys) {
            lines.push(`npx tsx tools/vr/ExportGltf.ts ../vr-client/assets/rs ${key}`);
        }
        lines.push('');
        lines.push('GODOT');
        lines.push(`append ${keys.join(', ')} to ZONE_SQUARES in vr-client/scripts/WorldStreamer.gd`);
        lines.push(`LostCityVR.bat then F12 at ${ctx.wx},${ctx.wz}`);
        lines.push('compare this folder to vr-client/debug-dumps/');
        lines.push('');
        lines.push('RULES');
        lines.push('do not invent locs');
        lines.push('if LOCS has no wall loc it is a 2004 gap');
        lines.push('walk uses _edges only (shape 0/9 one side, 1/3 none, 2 both)');
        lines.push('keep cook-east overlay 22');
        lines.push('do not flatten height');
        lines.push('loc-edits.json only after comparing this dump');
        lines.push('');
        const locLines: string[] = [];
        for (let z = ctx.wz - RADIUS; z <= ctx.wz + RADIUS; z++) {
            for (let x = ctx.wx - RADIUS; x <= ctx.wx + RADIUS; x++) {
                this.appendLocs(ctx, x, z, locLines);
            }
        }
        lines.push('COUNTS');
        if (locLines.length === 0) {
            lines.push('(none)');
        } else {
            lines.push(...this.locCountLines(locLines));
        }
        lines.push('');
        lines.push('LOCS');
        if (locLines.length === 0) {
            lines.push('(none)');
        } else {
            lines.push(...locLines);
        }
        return lines.join('\n') + '\n';
    }

    private static locCountLines(locLines: string[]): string[] {
        const counts = new Map<string, number>();
        const re = /kind=(\S+) type=(\d+).*shape=(\d+).*level=(\d+)/;
        for (const line of locLines) {
            const m = line.match(re);
            if (!m) {
                continue;
            }
            const key = `kind=${m[1]} type=${m[2]} shape=${m[3]} level=${m[4]}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return [...counts.keys()].sort().map(key => `n=${counts.get(key)} ${key}`);
    }

    private static tileLine(ctx: RefDumpCtx, wx: number, wz: number): string {
        const lx = wx - ctx.mapBuildBaseX;
        const lz = wz - ctx.mapBuildBaseZ;
        if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) {
            return `tile ${wx},${wz} off-map`;
        }
        const h = ctx.groundh?.[0];
        const h00 = h ? h[lx][lz] : 0;
        const h10 = h ? h[lx + 1]?.[lz] ?? 0 : 0;
        const h01 = h ? h[lx][lz + 1] ?? 0 : 0;
        const h11 = h ? h[lx + 1]?.[lz + 1] ?? 0 : 0;
        const cmap = ctx.collision[0];
        const flags = cmap ? cmap.flags[CollisionMap.index(lx, lz)] : 0;
        let ov = -1;
        let und = -1;
        let packed = -1;
        let rot = -1;
        if (ctx.build) {
            und = ctx.build.underlayAt(0, lx, lz);
            ov = ctx.build.overlayAt(0, lx, lz);
            packed = ctx.build.overlayShapeAt(0, lx, lz);
            rot = ctx.build.overlayRotAt(0, lx, lz);
        }
        return `tile ${wx},${wz} lx=${lx},${lz} ov=${ov} packed=${packed} rot=${rot} und=${und} flags=${flags} h=(${h00},${h10},${h01},${h11})`;
    }

    private static appendLocs(ctx: RefDumpCtx, wx: number, wz: number, lines: string[]): void {
        if (!ctx.world) {
            return;
        }
        const lx = wx - ctx.mapBuildBaseX;
        const lz = wz - ctx.mapBuildBaseZ;
        if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) {
            return;
        }
        for (let level = 0; level < BuildArea.LEVELS; level++) {
            const tile = ctx.world.squareAt(level, lx, lz);
            if (!tile) {
                continue;
            }
            if (tile.wall) {
                const info = tile.wall.typecode2 & 0xff;
                lines.push(this.locLine('wall', tile.wall.typecode, info, level, wx, wz, tile.wall.model1 ? 'yes' : 'no', tile.wall.model2 ? 'yes' : 'no'));
            }
            if (tile.decor) {
                const info = tile.decor.typecode2 & 0xff;
                lines.push(this.locLine('decor', tile.decor.typecode, info, level, wx, wz, tile.decor.model ? 'yes' : 'no', 'no'));
            }
            if (tile.groundDecor) {
                const info = tile.groundDecor.typecode2 & 0xff;
                lines.push(this.locLine('gdecor', tile.groundDecor.typecode, info, level, wx, wz, tile.groundDecor.model ? 'yes' : 'no', 'no'));
            }
            for (let i = 0; i < tile.spriteCount; i++) {
                const sprite = tile.sprites[i];
                if (!sprite || sprite.minTileX !== lx || sprite.minTileZ !== lz) {
                    continue;
                }
                if (((sprite.typecode >> 29) & 0x3) !== 2) {
                    continue;
                }
                const info = sprite.typecode2 & 0xff;
                lines.push(this.locLine('scenery', sprite.typecode, info, level, wx, wz, sprite.model ? 'yes' : 'no', 'no'));
            }
        }
    }

    private static locLine(kind: string, typecode: number, info: number, level: number, wx: number, wz: number, model1: string, model2: string): string {
        const locId = (typecode >> 14) & 0x7fff;
        const shape = info & 0x1f;
        const angle = (info >> 6) & 0x3;
        let name = '';
        try {
            name = LocType.list(locId)?.name ?? '';
        } catch {
            name = '';
        }
        return `loc kind=${kind} type=${locId} name=${name} shape=${shape} angle=${angle} level=${level} at ${wx},${wz} model1=${model1} model2=${model2}`;
    }
}
