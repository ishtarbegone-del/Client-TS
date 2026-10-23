import { canvas } from '#/graphics/Canvas.js';

import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';
import { CollisionFlag } from '#/dash3d/CollisionFlag.js';
import { MapFlag } from '#/dash3d/MapFlag.js';
import FloType from '#/config/FloType.js';
import IfType from '#/config/IfType.js';
import LocType from '#/config/LocType.js';
import SeqType from '#/config/SeqType.js';
import type ClientBuild from '#/client/ClientBuild.js';
import type World from '#/dash3d/World.js';
import {
    avgHeightM,
    buildHouseText,
    buildRoofText,
    decodeBlockDirs,
    describeLoc,
    findNearestRoofHouse,
    floodHouse,
    heightAt,
    locLine,
    ROOF_SCAN
} from '#/client/HouseBlueprint.js';
import { buildEquipAlign, buildInvColors, buildInvVerts, buildModelCallbacks, type RefPlayerInv } from '#/client/RefInvDump.js';
import { buildGroundObjs, buildGroundVerts } from '#/client/RefGroundDump.js';
import type ClientObj from '#/dash3d/ClientObj.js';
import type LinkList from '#/datastruct/LinkList.js';

const INGEST = 'http://127.0.0.1:43596/capture';
const RADIUS = ROOF_SCAN;
const MAX_TICKS = 25;
const INTERVAL_MS = 600;

export type RefLocAnim = {
    type: number;
    seq: number;
    frame: number;
    frames: number;
    duration: number;
};

export type RefUi = {
    mainModal: number;
    sideModal: number;
    sideTab: number;
    sideOverlay: number;
    chatCom: number;
    tutCom: number;
    menu: string[];
};

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
    locAnims?: RefLocAnim[];
    playerLines?: string[];
    npcLines?: string[];
    seqLines?: string[];
    ui?: RefUi;
    level?: number;
    player?: RefPlayerInv | null;
    groundObj?: (LinkList<ClientObj> | null)[][][] | null;
    mapl?: Uint8Array[][] | null;
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

    static async dumpHouse(ctx: RefDumpCtx, chat: (msg: string) => void): Promise<void> {
        const level = ctx.level ?? 0;
        const fill = ctx.world
            ? floodHouse(ctx.world, ctx.mapBuildBaseX, ctx.mapBuildBaseZ, ctx.wx, ctx.wz, level, ctx.collision[level] ?? null)
            : { inside: false, tiles: [], reason: 'no-world' };
        const dump = buildHouseText({
            wx: ctx.wx,
            wz: ctx.wz,
            level,
            baseX: ctx.mapBuildBaseX,
            baseZ: ctx.mapBuildBaseZ,
            fill,
            groundh: ctx.groundh,
            collision: ctx.collision,
            world: ctx.world,
            build: ctx.build
        });
        if (!fill.inside) {
            chat('not inside a house');
        } else {
            const walkCounts: number[] = [];
            for (let lvl = 0; lvl < 4; lvl++) {
                const re = new RegExp(`tile \\d+,\\d+ level=${lvl} flags=\\d+ walk=yes`, 'g');
                walkCounts.push((dump.match(re) ?? []).length);
            }
            chat(
                `inside house tiles=${fill.tiles.length} floor=${level} walkable L0=${walkCounts[0]} L1=${walkCounts[1]} L2=${walkCounts[2]} L3=${walkCounts[3]}`
            );
        }
        const now = new Date();
        const pad = (n: number): string => String(n).padStart(2, '0');
        const session = `house-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        try {
            const res = await fetch(INGEST, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind: 'house',
                    session,
                    tick: 0,
                    wx: ctx.wx,
                    wz: ctx.wz,
                    dump
                })
            });
            if (!res.ok) {
                console.warn('house dump ingest rejected', res.status);
            }
        } catch {
            console.warn('house dump ingest down — start LostCityRef.bat');
            chat('house dump ingest down');
        }
    }

    static async dumpRoof(ctx: RefDumpCtx, chat: (msg: string) => void): Promise<void> {
        const pick = ctx.world
            ? findNearestRoofHouse(ctx.world, ctx.mapBuildBaseX, ctx.mapBuildBaseZ, ctx.wx, ctx.wz, ctx.collision)
            : { outside: true, seed: { x: ctx.wx, z: ctx.wz }, tiles: [], cluster: [], reason: 'no-world' };
        const dump = buildRoofText({
            wx: ctx.wx,
            wz: ctx.wz,
            baseX: ctx.mapBuildBaseX,
            baseZ: ctx.mapBuildBaseZ,
            pick,
            groundh: ctx.groundh,
            world: ctx.world,
            mapl: ctx.mapl ?? null
        });
        if (pick.reason === 'no-roofs' || pick.reason === 'no-world') {
            chat(`no roof house ${pick.reason}`);
        } else {
            chat(`roof house outside=${pick.outside ? 'yes' : 'no'} tiles=${pick.tiles.length} seed=${pick.seed.x},${pick.seed.z}`);
        }
        const now = new Date();
        const pad = (n: number): string => String(n).padStart(2, '0');
        const session = `roof-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        try {
            const res = await fetch(INGEST, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind: 'roof',
                    session,
                    tick: 0,
                    wx: ctx.wx,
                    wz: ctx.wz,
                    dump
                })
            });
            if (!res.ok) {
                console.warn('roof dump ingest rejected', res.status);
            }
        } catch {
            console.warn('roof dump ingest down — start LostCityRef.bat');
            chat('roof dump ingest down');
        }
    }

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
        const invVerts = buildInvVerts(ctx.player ?? null);
        const invColors = buildInvColors(ctx.player ?? null);
        const modelCallbacks = buildModelCallbacks(ctx.player ?? null);
        const equipAlign = buildEquipAlign(ctx.player ?? null);
        const groundObjs = buildGroundObjs(ctx);
        const groundVerts = buildGroundVerts(ctx);
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
                    png,
                    invVerts,
                    invColors,
                    modelCallbacks,
                    equipAlign,
                    groundObjs,
                    groundVerts
                })
            });
            if (!res.ok && !this.warned) {
                this.warned = true;
                console.warn('ref capture ingest rejected', res.status);
                this.notify?.(`ingest rejected ${res.status} — start LostCityRef.bat`);
            }
        } catch {
            if (!this.warned) {
                this.warned = true;
                console.warn('ref capture ingest down — start LostCityRef.bat');
                this.notify?.('ingest down — start LostCityRef.bat');
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
                for (let level = 0; level < BuildArea.LEVELS; level++) {
                    const line = this.tileLine(ctx, x, z, level);
                    if (line) {
                        lines.push(line);
                    }
                }
            }
        }
        lines.push('');
        this.appendEdges(ctx, lines);
        lines.push('');
        lines.push('LOCS');
        for (let z = ctx.wz - RADIUS; z <= ctx.wz + RADIUS; z++) {
            for (let x = ctx.wx - RADIUS; x <= ctx.wx + RADIUS; x++) {
                this.appendLocs(ctx, x, z, lines);
            }
        }
        lines.push('');
        this.appendAnims(ctx, lines);
        lines.push('');
        this.appendEntities(ctx, lines);
        lines.push('');
        this.appendUi(ctx, lines);
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
        lines.push('if ANIMS has no loc seq do not invent a door swing');
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
        lines.push('');
        this.appendAnims(ctx, lines);
        lines.push('');
        this.appendEntities(ctx, lines);
        lines.push('');
        this.appendUi(ctx, lines);
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

    private static tileLine(ctx: RefDumpCtx, wx: number, wz: number, level: number): string | null {
        const lx = wx - ctx.mapBuildBaseX;
        const lz = wz - ctx.mapBuildBaseZ;
        if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) {
            return level === 0 ? `tile ${wx},${wz} off-map` : null;
        }
        const h = heightAt(ctx.groundh, level, lx, lz);
        const cmap = ctx.collision[level];
        const flags = cmap ? cmap.flags[CollisionMap.index(lx, lz)] : 0;
        let ov = -1;
        let und = -1;
        let packed = -1;
        let rot = -1;
        if (ctx.build) {
            und = ctx.build.underlayAt(level, lx, lz);
            ov = ctx.build.overlayAt(level, lx, lz);
            packed = ctx.build.overlayShapeAt(level, lx, lz);
            rot = ctx.build.overlayRotAt(level, lx, lz);
        }
        const mapl = ctx.mapl?.[level]?.[lx]?.[lz] ?? 0;
        const mapl1 = ctx.mapl?.[1]?.[lx]?.[lz] ?? 0;
        const linkBelow = (mapl1 & MapFlag.LinkBelow) !== 0;
        const block = (mapl & MapFlag.Block) !== 0;
        if (level > 0 && ov <= 0 && und <= 0 && flags === 0 && mapl === 0 && h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
            return null;
        }
        const flo = this.floLook(ov > 0 ? ov : und);
        const emit = ov > 0 && packed > 0 ? 'tris' : 'flat';
        const walk = (flags & CollisionFlag.SQ_BLOCKED) === 0 ? 'yes' : 'no';
        return (
            `tile ${wx},${wz} level=${level} lx=${lx},${lz} ov=${ov} packed=${packed} rot=${rot} und=${und}` +
            ` flags=${flags} mapl=${mapl} linkBelow=${linkBelow ? 'yes' : 'no'} block=${block ? 'yes' : 'no'}` +
            ` walk=${walk} edges=${decodeBlockDirs(flags)} floTex=${flo.tex} floRgb=${flo.rgb} emit=${emit}` +
            ` h=(${h[0]},${h[1]},${h[2]},${h[3]}) y=${avgHeightM(h).toFixed(3)}`
        );
    }

    private static floLook(id: number): { tex: number; rgb: number } {
        if (id <= 0 || id >= FloType.list.length || !FloType.list[id]) {
            return { tex: -1, rgb: 0 };
        }
        const flo = FloType.list[id];
        return { tex: flo.texture, rgb: flo.colour };
    }

    private static appendEdges(ctx: RefDumpCtx, lines: string[]): void {
        lines.push('EDGES');
        lines.push('CollisionMap W_N/E/S/W; compare to VR EDGES LIVE');
        const keys = new Set<string>();
        for (let level = 0; level < BuildArea.LEVELS; level++) {
            const cmap = ctx.collision[level];
            if (!cmap) {
                continue;
            }
            for (let z = ctx.wz - RADIUS; z <= ctx.wz + RADIUS; z++) {
                for (let x = ctx.wx - RADIUS; x <= ctx.wx + RADIUS; x++) {
                    const lx = x - ctx.mapBuildBaseX;
                    const lz = z - ctx.mapBuildBaseZ;
                    if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) {
                        continue;
                    }
                    const flags = cmap.flags[CollisionMap.index(lx, lz)];
                    const add = (bx: number, bz: number) => {
                        const a = x < bx || (x === bx && z < bz) ? `${x},${z}>${bx},${bz}` : `${bx},${bz}>${x},${z}`;
                        keys.add(`edge ${a} level=${level}`);
                    };
                    if ((flags & CollisionFlag.W_W) !== 0) {
                        add(x - 1, z);
                    }
                    if ((flags & CollisionFlag.W_E) !== 0) {
                        add(x + 1, z);
                    }
                    if ((flags & CollisionFlag.W_N) !== 0) {
                        add(x, z + 1);
                    }
                    if ((flags & CollisionFlag.W_S) !== 0) {
                        add(x, z - 1);
                    }
                }
            }
        }
        if (keys.size === 0) {
            lines.push('(none in radius)');
            return;
        }
        lines.push(...[...keys].sort());
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
                lines.push(
                    this.locDumpLine('wall', tile.wall.typecode, info, level, wx, wz, lx, lz, ctx, tile.wall.model1 ? 'yes' : 'no', tile.wall.model2 ? 'yes' : 'no')
                );
            }
            if (tile.decor) {
                const info = tile.decor.typecode2 & 0xff;
                lines.push(this.locDumpLine('decor', tile.decor.typecode, info, level, wx, wz, lx, lz, ctx, tile.decor.model ? 'yes' : 'no', 'no'));
            }
            if (tile.groundDecor) {
                const info = tile.groundDecor.typecode2 & 0xff;
                lines.push(
                    this.locDumpLine('gdecor', tile.groundDecor.typecode, info, level, wx, wz, lx, lz, ctx, tile.groundDecor.model ? 'yes' : 'no', 'no')
                );
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
                lines.push(this.locDumpLine('scenery', sprite.typecode, info, level, wx, wz, lx, lz, ctx, sprite.model ? 'yes' : 'no', 'no'));
            }
        }
    }

    private static locDumpLine(
        kind: string,
        typecode: number,
        info: number,
        level: number,
        wx: number,
        wz: number,
        lx: number,
        lz: number,
        ctx: RefDumpCtx,
        model1: string,
        model2: string
    ): string {
        const locId = (typecode >> 14) & 0x7fff;
        let anim = -1;
        let frames = 0;
        let duration = 0;
        try {
            anim = LocType.list(locId)?.anim ?? -1;
            if (anim >= 0 && SeqType.list[anim]) {
                frames = SeqType.list[anim].numFrames;
                duration = SeqType.list[anim].duration;
            }
        } catch {
            anim = -1;
        }
        const live = ` model1=${model1} model2=${model2} anim=${anim} frames=${frames} duration=${duration}`;
        const loc = describeLoc(kind, typecode, info, level, wx, wz);
        const yM = avgHeightM(heightAt(ctx.groundh, level, lx, lz));
        if (loc) {
            return locLine(loc, yM) + live;
        }
        const shape = info & 0x1f;
        const angle = (info >> 6) & 0x3;
        let name = '';
        try {
            name = LocType.list(locId)?.name ?? '';
        } catch {
            name = '';
        }
        return `loc kind=${kind} type=${locId} name=${name} shape=${shape} angle=${angle} level=${level} at ${wx},${wz} y=${yM.toFixed(3)}${live}`;
    }

    private static ifLine(id: number): string {
        if (id < 0 || !IfType.list[id]) {
            return String(id);
        }
        const com = IfType.list[id];
        const scripts = com.scripts ? com.scripts.filter(s => s !== null).length : 0;
        return `${id} type=${com.type} clientCode=${com.clientCode} scripts=${scripts}`;
    }

    private static appendAnims(ctx: RefDumpCtx, lines: string[]): void {
        lines.push('ANIMS');
        const live = ctx.locAnims ?? [];
        if (live.length === 0) {
            lines.push('(none)');
            return;
        }
        for (const anim of live) {
            lines.push(`anim loc type=${anim.type} seq=${anim.seq} frame=${anim.frame} frames=${anim.frames} duration=${anim.duration}`);
        }
    }

    private static appendEntities(ctx: RefDumpCtx, lines: string[]): void {
        lines.push('PLAYERS');
        const players = ctx.playerLines ?? [];
        if (players.length === 0) {
            lines.push('(none)');
        } else {
            lines.push(...players);
        }
        lines.push('NPCS');
        const npcs = ctx.npcLines ?? [];
        if (npcs.length === 0) {
            lines.push('(none)');
        } else {
            lines.push(...npcs);
        }
        lines.push('SEQS');
        const seqs = ctx.seqLines ?? [];
        if (seqs.length === 0) {
            lines.push('(none)');
        } else {
            lines.push(...seqs);
        }
    }

    private static appendUi(ctx: RefDumpCtx, lines: string[]): void {
        lines.push('UI');
        const ui = ctx.ui;
        if (!ui) {
            lines.push('(none)');
            return;
        }
        lines.push(`ui mainModal=${this.ifLine(ui.mainModal)}`);
        lines.push(`ui sideModal=${this.ifLine(ui.sideModal)}`);
        lines.push(`ui sideTab=${ui.sideTab} overlay=${this.ifLine(ui.sideOverlay)}`);
        lines.push(`ui chatCom=${this.ifLine(ui.chatCom)}`);
        lines.push(`ui tutCom=${this.ifLine(ui.tutCom)}`);
        if (ui.menu.length === 0) {
            lines.push('ui menu (none)');
            return;
        }
        for (let i = 0; i < ui.menu.length; i++) {
            lines.push(`ui menu ${i} ${ui.menu[i]}`);
        }
    }
}
