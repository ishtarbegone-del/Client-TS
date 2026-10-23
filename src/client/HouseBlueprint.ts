import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';
import { CollisionFlag } from '#/dash3d/CollisionFlag.js';
import { MapFlag } from '#/dash3d/MapFlag.js';
import LocType from '#/config/LocType.js';
import Model from '#/dash3d/Model.js';
import type World from '#/dash3d/World.js';
import type ClientBuild from '#/client/ClientBuild.js';

export const ESCAPE = 16;
export const ROOF_SCAN = 48;
const LEVEL_HEIGHT_RS = 240;

export type HouseTile = { x: number; z: number };

export type HouseLoc = {
    kind: string;
    type: number;
    name: string;
    shape: number;
    angle: number;
    level: number;
    x: number;
    z: number;
    width: number;
    length: number;
    wallwidth: number;
    resizex: number;
    resizey: number;
    resizez: number;
    offsetx: number;
    offsety: number;
    offsetz: number;
    models: number[];
    shapes: number[];
    modelId: number;
    hasalpha: boolean;
    tex: number[];
    blockwalk: boolean;
    occlude: boolean;
    hillskew: boolean;
};

export type HouseFill = {
    inside: boolean;
    tiles: HouseTile[];
    reason: string;
};

function edgeKey(ax: number, az: number, bx: number, bz: number): string {
    if (ax < bx || (ax === bx && az < bz)) {
        return `${ax},${az}>${bx},${bz}`;
    }
    return `${bx},${bz}>${ax},${az}`;
}

function isWallShape(shape: number): boolean {
    return shape <= 3 || shape === 9;
}

function isWallDecor(shape: number): boolean {
    return shape >= 4 && shape <= 8;
}

function isRoofShape(shape: number): boolean {
    return shape >= 12 && shape <= 21;
}

function padTiles(tiles: HouseTile[], pad: number): HouseTile[] {
    const seen = new Set<string>();
    const out: HouseTile[] = [];
    for (const t of tiles) {
        for (let dx = -pad; dx <= pad; dx++) {
            for (let dz = -pad; dz <= pad; dz++) {
                const x = t.x + dx;
                const z = t.z + dz;
                const key = `${x},${z}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                out.push({ x, z });
            }
        }
    }
    out.sort((a, b) => a.z - b.z || a.x - b.x);
    return out;
}

function isListedRoof(loc: HouseLoc, level: number): boolean {
    if (loc.type !== 1933 || loc.level !== level) {
        return false;
    }
    if (level === 1) {
        return loc.shape === 12 || loc.shape === 13 || loc.shape === 14 || loc.shape === 16 || loc.shape === 17;
    }
    if (level === 3) {
        return loc.shape === 12 || loc.shape === 13 || loc.shape === 16 || loc.shape === 17;
    }
    return false;
}

function isGuideHousePad(x: number, z: number): boolean {
    return x >= 3086 && x <= 3098 && z >= 3099 && z <= 3113;
}

function isGuideRoofEdge(x: number, z: number, floodKeys: Set<string>): boolean {
    if (!floodKeys.has(`${x},${z}`)) {
        return false;
    }
    const dirs: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
    ];
    return dirs.some(([dx, dz]) => !floodKeys.has(`${x + dx},${z + dz}`));
}

function shutterInto(angle: number): [number, number] {
    switch (angle % 4) {
        case 0:
            return [-1, 0];
        case 1:
            return [0, 1];
        case 2:
            return [1, 0];
        default:
            return [0, -1];
    }
}

function shutterAxisMatch(shutterAngle: number, wallAngle: number): boolean {
    return shutterAngle % 2 === wallAngle % 2;
}

function findShutterWall(loc: HouseLoc, walls: HouseLoc[]): HouseLoc | undefined {
    const [dx, dz] = shutterInto(loc.angle);
    return (
        walls.find(w => w.x === loc.x && w.z === loc.z && w.level === loc.level) ??
        walls.find(w => w.x === loc.x + dx && w.z === loc.z + dz && w.level === loc.level)
    );
}

function nearbyShutterTiles(loc: HouseLoc, pair?: HouseLoc): Array<[number, number]> {
    const tiles: Array<[number, number]> = [[loc.x, loc.z]];
    const [dx, dz] = shutterInto(loc.angle);
    tiles.push([loc.x + dx, loc.z + dz]);
    if (pair) {
        tiles.push([pair.x, pair.z]);
        const [pdx, pdz] = shutterInto(pair.angle);
        tiles.push([pair.x + pdx, pair.z + pdz]);
    }
    return tiles;
}

function findShutterLeaves(loc: HouseLoc, walls: HouseLoc[], pair?: HouseLoc): HouseLoc[] {
    const tiles = new Set(nearbyShutterTiles(loc, pair).map(([x, z]) => `${x},${z}`));
    return walls.filter(
        w =>
            w.level === loc.level &&
            tiles.has(`${w.x},${w.z}`) &&
            shutterAxisMatch(loc.angle, w.angle)
    );
}

function findShutterSkip(loc: HouseLoc, walls: HouseLoc[]): HouseLoc[] {
    return walls.filter(
        w => w.x === loc.x && w.z === loc.z && w.level === loc.level && !shutterAxisMatch(loc.angle, w.angle)
    );
}

function findShutterPair(loc: HouseLoc, all: HouseLoc[]): HouseLoc | undefined {
    const opp = (loc.angle + 2) % 4;
    const same = all.find(
        s => s !== loc && s.x === loc.x && s.z === loc.z && s.level === loc.level && s.angle % 4 === opp
    );
    if (same) {
        return same;
    }
    const [dx, dz] = shutterInto(loc.angle);
    return all.find(s => s.x === loc.x + dx && s.z === loc.z + dz && s.level === loc.level && s.angle % 4 === opp);
}

function remapGuideRoofShape(loc: HouseLoc, floodKeys: Set<string>): number {
    if (loc.type !== 1933 || !isRoofShape(loc.shape) || !isGuideHousePad(loc.x, loc.z)) {
        return loc.shape;
    }
    if (loc.shape === 13) {
        return 12;
    }
    if (isGuideRoofEdge(loc.x, loc.z, floodKeys)) {
        return loc.shape === 16 ? 12 : loc.shape;
    }
    if (floodKeys.has(`${loc.x},${loc.z}`)) {
        return 17;
    }
    return loc.shape;
}

function fullEdges(x: number, z: number, shape: number, angle: number): Array<[number, number, number, number]> {
    if (shape === 1 || shape === 3) {
        return [];
    }
    const a = angle % 4;
    if (shape === 2) {
        if (a === 0) {
            return [
                [x, z, x - 1, z],
                [x, z, x, z + 1]
            ];
        }
        if (a === 1) {
            return [
                [x, z, x, z + 1],
                [x, z, x + 1, z]
            ];
        }
        if (a === 2) {
            return [
                [x, z, x + 1, z],
                [x, z, x, z - 1]
            ];
        }
        return [
            [x, z, x, z - 1],
            [x, z, x - 1, z]
        ];
    }
    if (a === 0) {
        return [[x, z, x - 1, z]];
    }
    if (a === 1) {
        return [[x, z, x, z + 1]];
    }
    if (a === 2) {
        return [[x, z, x + 1, z]];
    }
    return [[x, z, x, z - 1]];
}

function locInfo(typecode: number, info: number): { type: number; shape: number; angle: number } {
    return {
        type: (typecode >> 14) & 0x7fff,
        shape: info & 0x1f,
        angle: (info >> 6) & 0x3
    };
}

function visitTileLocs(world: World, level: number, lx: number, lz: number, fn: (kind: string, typecode: number, info: number) => void): void {
    const tile = world.squareAt(level, lx, lz);
    if (!tile) {
        return;
    }
    if (tile.wall) {
        fn('wall', tile.wall.typecode, tile.wall.typecode2 & 0xff);
    }
    if (tile.decor) {
        fn('decor', tile.decor.typecode, tile.decor.typecode2 & 0xff);
    }
    if (tile.groundDecor) {
        fn('gdecor', tile.groundDecor.typecode, tile.groundDecor.typecode2 & 0xff);
    }
    for (let i = 0; i < tile.spriteCount; i++) {
        const sprite = tile.sprites[i];
        if (!sprite || sprite.minTileX !== lx || sprite.minTileZ !== lz) {
            continue;
        }
        if (((sprite.typecode >> 29) & 0x3) !== 2) {
            continue;
        }
        fn('scenery', sprite.typecode, sprite.typecode2 & 0xff);
    }
}

function addCollisionEdges(edges: Set<string>, cmap: CollisionMap | null, baseX: number, baseZ: number): void {
    if (!cmap) {
        return;
    }
    for (let lz = 0; lz < BuildArea.SIZE; lz++) {
        for (let lx = 0; lx < BuildArea.SIZE; lx++) {
            const flags = cmap.flags[CollisionMap.index(lx, lz)];
            const wx = baseX + lx;
            const wz = baseZ + lz;
            if ((flags & CollisionFlag.W_W) !== 0) {
                edges.add(edgeKey(wx, wz, wx - 1, wz));
            }
            if ((flags & CollisionFlag.W_E) !== 0) {
                edges.add(edgeKey(wx, wz, wx + 1, wz));
            }
            if ((flags & CollisionFlag.W_N) !== 0) {
                edges.add(edgeKey(wx, wz, wx, wz + 1));
            }
            if ((flags & CollisionFlag.W_S) !== 0) {
                edges.add(edgeKey(wx, wz, wx, wz - 1));
            }
        }
    }
}

function isWalkableFlags(flags: number): boolean {
    return (flags & CollisionFlag.SQ_BLOCKED) === 0;
}

export function decodeBlockDirs(flags: number): string {
    let out = '';
    if ((flags & CollisionFlag.W_N) !== 0) {
        out += 'N';
    }
    if ((flags & CollisionFlag.W_E) !== 0) {
        out += 'E';
    }
    if ((flags & CollisionFlag.W_S) !== 0) {
        out += 'S';
    }
    if ((flags & CollisionFlag.W_W) !== 0) {
        out += 'W';
    }
    return out.length > 0 ? out : 'none';
}

function edgeTouchesFlood(key: string, floodKeys: Set<string>): boolean {
    const parts = key.split('>');
    if (parts.length !== 2) {
        return false;
    }
    return parts.some(part => floodKeys.has(part));
}

function appendWalkClipSections(
    lines: string[],
    args: {
        baseX: number;
        baseZ: number;
        tiles: HouseTile[];
        collision: (CollisionMap | null)[];
    }
): number[] {
    const { baseX, baseZ, tiles, collision } = args;
    const floodKeys = new Set(tiles.map(t => `${t.x},${t.z}`));
    const walkCounts: number[] = [];
    lines.push('WALK');
    lines.push(
        'CollisionMap walkable floors over FLOOR flood tiles for levels 0-3; walk=yes when (flags & SQ_BLOCKED)==0'
    );
    for (let lvl = 0; lvl < BuildArea.LEVELS; lvl++) {
        const cmap = collision[lvl] ?? null;
        let walkable = 0;
        for (const t of tiles) {
            const lx = t.x - baseX;
            const lz = t.z - baseZ;
            if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) {
                continue;
            }
            const flags = cmap ? cmap.flags[CollisionMap.index(lx, lz)] : CollisionFlag.UNLOADED;
            const walk = isWalkableFlags(flags);
            if (walk) {
                walkable++;
            }
            lines.push(
                `tile ${t.x},${t.z} level=${lvl} flags=${flags} walk=${walk ? 'yes' : 'no'} block=${decodeBlockDirs(flags)} sq=${walk ? 'open' : 'blocked'}`
            );
        }
        walkCounts.push(walkable);
    }
    lines.push('');
    lines.push('CLIP');
    lines.push('CollisionMap W_N/E/S/W edges touching FLOOR flood; compare to VR EDGES LIVE / story edges');
    let clipAny = false;
    for (let lvl = 0; lvl < BuildArea.LEVELS; lvl++) {
        const edges = new Set<string>();
        addCollisionEdges(edges, collision[lvl] ?? null, baseX, baseZ);
        const filtered = [...edges].filter(key => edgeTouchesFlood(key, floodKeys));
        filtered.sort();
        for (const key of filtered) {
            clipAny = true;
            lines.push(`edge ${key} level=${lvl}`);
        }
    }
    if (!clipAny) {
        lines.push('(none)');
    }
    return walkCounts;
}

function locTypeOf(type: number): LocType | null {
    try {
        return LocType.list(type);
    } catch {
        return null;
    }
}

function occupyFootprint(occupied: Set<string>, wx: number, wz: number, shape: number, angle: number, loc: LocType | null): void {
    if (isWallDecor(shape) || shape === 9) {
        occupied.add(`${wx},${wz}`);
        return;
    }
    if (shape !== 10 && shape !== 11) {
        return;
    }
    if (!loc || !loc.blockwalk) {
        return;
    }
    let width = loc.width;
    let length = loc.length;
    if (angle === 1 || angle === 3) {
        const tmp = width;
        width = length;
        length = tmp;
    }
    for (let dx = 0; dx < width; dx++) {
        for (let dz = 0; dz < length; dz++) {
            occupied.add(`${wx + dx},${wz + dz}`);
        }
    }
}

function collectEdges(
    world: World,
    baseX: number,
    baseZ: number,
    level: number,
    collision: CollisionMap | null
): { edges: Set<string>; occupied: Set<string> } {
    const edges = new Set<string>();
    const occupied = new Set<string>();
    for (let lz = 0; lz < BuildArea.SIZE; lz++) {
        for (let lx = 0; lx < BuildArea.SIZE; lx++) {
            visitTileLocs(world, level, lx, lz, (_kind, typecode, info) => {
                const { type, shape, angle } = locInfo(typecode, info);
                const wx = baseX + lx;
                const wz = baseZ + lz;
                occupyFootprint(occupied, wx, wz, shape, angle, locTypeOf(type));
                const edgeShape = isWallDecor(shape) ? 0 : shape;
                if (!isWallDecor(shape) && !isWallShape(shape)) {
                    return;
                }
                for (const [ax, az, bx, bz] of fullEdges(wx, wz, edgeShape, angle)) {
                    edges.add(edgeKey(ax, az, bx, bz));
                }
            });
        }
    }
    addCollisionEdges(edges, collision, baseX, baseZ);
    return { edges, occupied };
}

function blocked(edges: Set<string>, x: number, z: number, nx: number, nz: number): boolean {
    return edges.has(edgeKey(x, z, nx, nz));
}

export function floodHouse(
    world: World,
    baseX: number,
    baseZ: number,
    wx: number,
    wz: number,
    level: number,
    collision: CollisionMap | null = null
): HouseFill {
    const { edges, occupied } = collectEdges(world, baseX, baseZ, level, collision);
    const startLx = wx - baseX;
    const startLz = wz - baseZ;
    if (startLx < 0 || startLz < 0 || startLx >= BuildArea.SIZE || startLz >= BuildArea.SIZE) {
        return { inside: false, tiles: [], reason: 'off-map' };
    }
    const seen = new Set<string>();
    const queue: HouseTile[] = [{ x: wx, z: wz }];
    seen.add(`${wx},${wz}`);
    const dirs: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
    ];
    while (queue.length > 0) {
        const cur = queue.pop()!;
        if (Math.max(Math.abs(cur.x - wx), Math.abs(cur.z - wz)) > ESCAPE) {
            return { inside: false, tiles: [], reason: 'escaped' };
        }
        for (const [dx, dz] of dirs) {
            const nx = cur.x + dx;
            const nz = cur.z + dz;
            if (blocked(edges, cur.x, cur.z, nx, nz)) {
                continue;
            }
            const key = `${nx},${nz}`;
            if (occupied.has(key)) {
                seen.add(key);
                continue;
            }
            const lx = nx - baseX;
            const lz = nz - baseZ;
            if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) {
                return { inside: false, tiles: [], reason: 'map-edge' };
            }
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            queue.push({ x: nx, z: nz });
        }
    }
    const tiles = [...seen].map(key => {
        const [x, z] = key.split(',').map(Number);
        return { x, z };
    });
    tiles.sort((a, b) => a.z - b.z || a.x - b.x);
    if (tiles.length < 2) {
        return { inside: false, tiles: [], reason: 'too-small' };
    }
    return { inside: true, tiles, reason: 'enclosed' };
}

function modelForShape(loc: LocType, shape: number): number {
    const lookup = shape >= 5 && shape <= 8 ? 4 : shape === 11 ? 10 : shape;
    const models = loc.model;
    const shapes = loc.shape;
    if (!models) {
        return -1;
    }
    if (shapes) {
        for (let i = 0; i < models.length; i++) {
            if (i < shapes.length && shapes[i] === lookup) {
                return models[i];
            }
        }
    }
    if (isWallShape(shape) && models.length > 0) {
        return models[0];
    }
    return -1;
}

function modelBits(modelId: number): { hasalpha: boolean; tex: number[] } {
    if (modelId < 0 || !Model.meta[modelId]) {
        return { hasalpha: false, tex: [] };
    }
    try {
        const model = Model.load(modelId);
        let hasalpha = false;
        if (model.faceAlpha) {
            for (let f = 0; f < model.numFaces; f++) {
                if (model.faceAlpha[f] > 0) {
                    hasalpha = true;
                    break;
                }
            }
        }
        const tex = new Set<number>();
        for (let f = 0; f < model.numFaces; f++) {
            const info = model.faceRenderType ? model.faceRenderType[f] : 0;
            if ((info & 0x2) !== 0x2) {
                continue;
            }
            const id = model.faceColour ? model.faceColour[f] : -1;
            if (id >= 0 && id <= 49) {
                tex.add(id);
            }
        }
        return { hasalpha, tex: [...tex].sort((a, b) => a - b) };
    } catch {
        return { hasalpha: false, tex: [] };
    }
}

export function describeLoc(kind: string, typecode: number, info: number, level: number, wx: number, wz: number): HouseLoc | null {
    const { type, shape, angle } = locInfo(typecode, info);
    let loc: LocType | null = null;
    try {
        loc = LocType.list(type);
    } catch {
        loc = null;
    }
    if (!loc) {
        return null;
    }
    const modelId = modelForShape(loc, shape);
    const bits = modelBits(modelId);
    return {
        kind,
        type,
        name: loc.name ?? '',
        shape,
        angle,
        level,
        x: wx,
        z: wz,
        width: loc.width,
        length: loc.length,
        wallwidth: loc.wallwidth,
        resizex: loc.resizex,
        resizey: loc.resizey,
        resizez: loc.resizez,
        offsetx: loc.offsetx,
        offsety: loc.offsety,
        offsetz: loc.offsetz,
        models: loc.model ? [...loc.model] : [],
        shapes: loc.shape ? [...loc.shape] : [],
        modelId,
        hasalpha: loc.animateTransparencies || bits.hasalpha,
        tex: bits.tex,
        blockwalk: loc.blockwalk,
        occlude: loc.occlude,
        hillskew: loc.hillskew
    };
}

export function collectHouseLocs(world: World, baseX: number, baseZ: number, tiles: HouseTile[], level: number, roofsOnly: boolean): HouseLoc[] {
    const out: HouseLoc[] = [];
    for (const tile of tiles) {
        const lx = tile.x - baseX;
        const lz = tile.z - baseZ;
        if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) {
            continue;
        }
        visitTileLocs(world, level, lx, lz, (kind, typecode, info) => {
            const loc = describeLoc(kind, typecode, info, level, tile.x, tile.z);
            if (!loc) {
                return;
            }
            if (roofsOnly && !isRoofShape(loc.shape)) {
                return;
            }
            out.push(loc);
        });
    }
    out.sort((a, b) => a.z - b.z || a.x - b.x || a.type - b.type);
    return out;
}

export function heightAt(groundh: Int32Array[][] | null, level: number, lx: number, lz: number): [number, number, number, number] {
    const h = groundh?.[level];
    if (!h) {
        return [0, 0, 0, 0];
    }
    return [h[lx]?.[lz] ?? 0, h[lx + 1]?.[lz] ?? 0, h[lx]?.[lz + 1] ?? 0, h[lx + 1]?.[lz + 1] ?? 0];
}

export function avgHeightM(h: [number, number, number, number]): number {
    return (h[0] + h[1] + h[2] + h[3]) / 4 / 128;
}

export function locLine(loc: HouseLoc, yM: number): string {
    return (
        `loc kind=${loc.kind} type=${loc.type} name=${loc.name} shape=${loc.shape} angle=${loc.angle} level=${loc.level} at ${loc.x},${loc.z}` +
        ` size=${loc.width}x${loc.length} wallwidth=${loc.wallwidth}` +
        ` scale=${loc.resizex},${loc.resizey},${loc.resizez} offset=${loc.offsetx},${loc.offsety},${loc.offsetz}` +
        ` model=${loc.modelId} models=${loc.models.join(',') || '-'} shapes=${loc.shapes.join(',') || '-'}` +
        ` hasalpha=${loc.hasalpha ? 'yes' : 'no'} tex=${loc.tex.join(',') || '-'}` +
        ` blockwalk=${loc.blockwalk ? 'yes' : 'no'} occlude=${loc.occlude ? 'yes' : 'no'} hillskew=${loc.hillskew ? 'yes' : 'no'}` +
        ` y=${yM.toFixed(3)}`
    );
}

export function buildHouseText(args: {
    wx: number;
    wz: number;
    level: number;
    baseX: number;
    baseZ: number;
    fill: HouseFill;
    groundh: Int32Array[][] | null;
    collision: (CollisionMap | null)[];
    world: World | null;
    build: ClientBuild | null;
}): string {
    const lines: string[] = [];
    const { fill, wx, wz, level, baseX, baseZ } = args;
    lines.push(`HOUSE inside=${fill.inside ? 'yes' : 'no'} floor=${level} tiles=${fill.tiles.length} reason=${fill.reason} player=${wx},${wz}`);
    if (!fill.inside) {
        lines.push('not inside a house');
        lines.push('');
        lines.push('VR');
        lines.push('do not invent locs');
        return `${lines.join('\n')}\n`;
    }
    let minX = wx;
    let maxX = wx;
    let minZ = wz;
    let maxZ = wz;
    for (const t of fill.tiles) {
        minX = Math.min(minX, t.x);
        maxX = Math.max(maxX, t.x);
        minZ = Math.min(minZ, t.z);
        maxZ = Math.max(maxZ, t.z);
    }
    lines.push(`HOUSE aabb=${minX},${minZ}..${maxX},${maxZ}`);
    lines.push('');
    lines.push('FLOOR');
    for (const t of fill.tiles) {
        const lx = t.x - baseX;
        const lz = t.z - baseZ;
        const h = heightAt(args.groundh, level, lx, lz);
        const cmap = args.collision[level];
        const flags = cmap ? cmap.flags[CollisionMap.index(lx, lz)] : 0;
        let ov = -1;
        let und = -1;
        let packed = -1;
        let rot = -1;
        if (args.build) {
            und = args.build.underlayAt(level, lx, lz);
            ov = args.build.overlayAt(level, lx, lz);
            packed = args.build.overlayShapeAt(level, lx, lz);
            rot = args.build.overlayRotAt(level, lx, lz);
        }
        lines.push(
            `tile ${t.x},${t.z} lx=${lx},${lz} ov=${ov} packed=${packed} rot=${rot} und=${und} flags=${flags} h=(${h[0]},${h[1]},${h[2]},${h[3]}) y=${avgHeightM(h).toFixed(3)}`
        );
    }
    lines.push('');
    appendWalkClipSections(lines, {
        baseX,
        baseZ,
        tiles: fill.tiles,
        collision: args.collision
    });
    lines.push('');
    lines.push('LOCS');
    const locs = args.world ? collectHouseLocs(args.world, baseX, baseZ, fill.tiles, level, false) : [];
    if (locs.length === 0) {
        lines.push('(none)');
    } else {
        for (const loc of locs) {
            const h = heightAt(args.groundh, loc.level, loc.x - baseX, loc.z - baseZ);
            lines.push(locLine(loc, avgHeightM(h)));
        }
    }
    lines.push('');
    const roofTiles = padTiles(fill.tiles, 1);
    const roofY = (loc: HouseLoc): number => {
        const h0 = heightAt(args.groundh, 0, loc.x - baseX, loc.z - baseZ);
        const h1: [number, number, number, number] = [
            h0[0] + LEVEL_HEIGHT_RS,
            h0[1] + LEVEL_HEIGHT_RS,
            h0[2] + LEVEL_HEIGHT_RS,
            h0[3] + LEVEL_HEIGHT_RS
        ];
        return avgHeightM(h1);
    };
    const writeRoofBlock = (title: string, roofs: HouseLoc[]) => {
        lines.push(title);
        if (roofs.length === 0) {
            lines.push('2004 gap — do not invent');
            return;
        }
        lines.push(
            'VR show L1 roofs at dump Y; hide L3 while L1 walls are hidden; do not flatten'
        );
        for (const loc of roofs) {
            const onFloor = floodKeys.has(`${loc.x},${loc.z}`);
            const hide = loc.level >= 3 ? ' hide=L3' : loc.shape === 16 && !onFloor ? ' hide=gable' : ' spawn=dumpY';
            lines.push(
                `${locLine(loc, roofY(loc))} material=2004-loc-${loc.type} placement=tile ${loc.x},${loc.z} level=${loc.level}${hide}`
            );
        }
    };
    const floodKeys = new Set(fill.tiles.map(t => `${t.x},${t.z}`));
    const l1Roofs = args.world
        ? collectHouseLocs(args.world, baseX, baseZ, roofTiles, 1, true).filter(loc => isListedRoof(loc, 1))
        : [];
    const l3Roofs = args.world
        ? collectHouseLocs(args.world, baseX, baseZ, roofTiles, 3, true).filter(loc => isListedRoof(loc, 3))
        : [];
    writeRoofBlock('ROOF L1', l1Roofs);
    lines.push('');
    writeRoofBlock('ROOF L3', l3Roofs);
    const cover17 = new Set<string>();
    for (const loc of [...l1Roofs, ...l3Roofs]) {
        if (remapGuideRoofShape(loc, floodKeys) === 17) {
            cover17.add(`${loc.x},${loc.z}`);
        }
    }
    const dirs: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
    ];
    const edgeTiles = fill.tiles.filter(t => dirs.some(([dx, dz]) => !floodKeys.has(`${t.x + dx},${t.z + dz}`)));
    const gapTiles = fill.tiles.filter(t => !cover17.has(`${t.x},${t.z}`));
    const pad13 = [...l1Roofs, ...l3Roofs].filter(loc => loc.shape === 13 && isGuideHousePad(loc.x, loc.z));
    lines.push('');
    lines.push('EDGE');
    lines.push('flood tiles with a 4-neighbor outside the house; VR keep 12/14 here');
    if (edgeTiles.length === 0) {
        lines.push('(none)');
    } else {
        for (const t of edgeTiles) {
            lines.push(`tile ${t.x},${t.z}`);
        }
    }
    lines.push('');
    lines.push('GAPS');
    lines.push('flood tiles with no 1933 shape 17 — 2004 gap, do not invent; do not flatten');
    if (gapTiles.length === 0) {
        lines.push('(none)');
    } else {
        for (const t of gapTiles) {
            lines.push(`tile ${t.x},${t.z}`);
        }
    }
    lines.push('');
    lines.push('PAD13');
    lines.push('pad 1933 shape 13; VR remap 13→12');
    if (pad13.length === 0) {
        lines.push('(none)');
    } else {
        for (const loc of pad13) {
            lines.push(`tile ${loc.x},${loc.z} level=${loc.level}`);
        }
    }
    lines.push('');
    const l0Pad = args.world ? collectHouseLocs(args.world, baseX, baseZ, roofTiles, 0, false) : [];
    const shutterLocs = l0Pad.filter(loc => loc.type === 1838);
    const wall1902 = l0Pad.filter(loc => loc.type === 1902);
    lines.push('SHUTTERS');
    lines.push('VR punch 1902 through both faces');
    if (shutterLocs.length === 0) {
        lines.push('(none)');
    } else {
        for (const loc of shutterLocs) {
            const side = floodKeys.has(`${loc.x},${loc.z}`) ? 'in' : 'out';
            const wall = findShutterWall(loc, wall1902);
            const pair = findShutterPair(loc, shutterLocs);
            const leaves = findShutterLeaves(loc, wall1902, pair);
            const skip = findShutterSkip(loc, wall1902);
            const match = wall ? (shutterAxisMatch(loc.angle, wall.angle) ? 'yes' : 'no') : 'no';
            const wallBit = wall ? ` wall=${wall.x},${wall.z}` : '';
            const wallangBit = wall ? ` wallang=${wall.angle}` : '';
            const leavesBit = leaves.length > 0 ? ` leaves=${leaves.map(w => `${w.x},${w.z}`).join('|')}` : ' leaves=-';
            const skipBit = skip.length > 0 ? ` skip=${skip.map(w => `${w.x},${w.z}`).join('|')}` : ' skip=-';
            const pairBit = pair ? ` pair=${pair.x},${pair.z}` : '';
            lines.push(
                `tile ${loc.x},${loc.z} shape=${loc.shape} angle=${loc.angle} side=${side}${wallBit}${wallangBit} match=${match}${leavesBit}${skipBit}${pairBit}`
            );
        }
    }
    lines.push('');
    lines.push('VR');
    lines.push('compare this folder to a VR F12 dump');
    lines.push('compare CLIP to VR EDGES LIVE / story edges');
    lines.push('keep cook-east overlay 22');
    lines.push('walk uses _edges (shape 0/9/4-8 one side, 1/3 none, 2 both) plus occupy 9/10/11/walldecor');
    lines.push('do not invent locs');
    lines.push('do not write loc-edits.json from this dump');
    return `${lines.join('\n')}\n`;
}

function chebyshev(ax: number, az: number, bx: number, bz: number): number {
    return Math.max(Math.abs(ax - bx), Math.abs(az - bz));
}

function scanRoofLocs(world: World, baseX: number, baseZ: number, wx: number, wz: number, radius: number): HouseLoc[] {
    const tiles: HouseTile[] = [];
    for (let z = wz - radius; z <= wz + radius; z++) {
        for (let x = wx - radius; x <= wx + radius; x++) {
            tiles.push({ x, z });
        }
    }
    const out: HouseLoc[] = [];
    for (let level = 0; level < BuildArea.LEVELS; level++) {
        out.push(...collectHouseLocs(world, baseX, baseZ, tiles, level, true));
    }
    return out;
}

function clusterRoofTiles(locs: HouseLoc[]): HouseTile[][] {
    const keys = new Set<string>();
    const tiles: HouseTile[] = [];
    for (const loc of locs) {
        const key = `${loc.x},${loc.z}`;
        if (keys.has(key)) {
            continue;
        }
        keys.add(key);
        tiles.push({ x: loc.x, z: loc.z });
    }
    const byKey = new Map(tiles.map(t => [`${t.x},${t.z}`, t]));
    const seen = new Set<string>();
    const clusters: HouseTile[][] = [];
    const dirs: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
    ];
    for (const start of tiles) {
        const startKey = `${start.x},${start.z}`;
        if (seen.has(startKey)) {
            continue;
        }
        const group: HouseTile[] = [];
        const queue = [start];
        seen.add(startKey);
        while (queue.length > 0) {
            const cur = queue.pop()!;
            group.push(cur);
            for (const [dx, dz] of dirs) {
                const next = byKey.get(`${cur.x + dx},${cur.z + dz}`);
                if (!next) {
                    continue;
                }
                const nk = `${next.x},${next.z}`;
                if (seen.has(nk)) {
                    continue;
                }
                seen.add(nk);
                queue.push(next);
            }
        }
        group.sort((a, b) => a.z - b.z || a.x - b.x);
        clusters.push(group);
    }
    return clusters;
}

function clusterDist(tiles: HouseTile[], wx: number, wz: number): number {
    let best = 1e9;
    for (const t of tiles) {
        best = Math.min(best, chebyshev(t.x, t.z, wx, wz));
    }
    return best;
}

function playerInCluster(tiles: HouseTile[], wx: number, wz: number): boolean {
    return tiles.some(t => t.x === wx && t.z === wz);
}

export type RoofHousePick = {
    outside: boolean;
    seed: HouseTile;
    tiles: HouseTile[];
    cluster: HouseTile[];
    reason: string;
};

export function findNearestRoofHouse(
    world: World,
    baseX: number,
    baseZ: number,
    wx: number,
    wz: number,
    collision: (CollisionMap | null)[]
): RoofHousePick {
    const roofs = scanRoofLocs(world, baseX, baseZ, wx, wz, ROOF_SCAN);
    const clusters = clusterRoofTiles(roofs);
    if (clusters.length === 0) {
        return { outside: true, seed: { x: wx, z: wz }, tiles: [], cluster: [], reason: 'no-roofs' };
    }
    const outside = clusters.filter(c => !playerInCluster(c, wx, wz));
    const pool = outside.length > 0 ? outside : clusters;
    pool.sort((a, b) => clusterDist(a, wx, wz) - clusterDist(b, wx, wz) || a.length - b.length);
    const cluster = pool[0];
    const seed = [...cluster].sort((a, b) => chebyshev(a.x, a.z, wx, wz) - chebyshev(b.x, b.z, wx, wz))[0];
    let fill: HouseFill = { inside: false, tiles: [], reason: 'no-seed' };
    for (const trySeed of [seed, ...cluster]) {
        fill = floodHouse(world, baseX, baseZ, trySeed.x, trySeed.z, 0, collision[0] ?? null);
        if (fill.inside) {
            return {
                outside: !playerInCluster(cluster, wx, wz),
                seed: trySeed,
                tiles: fill.tiles,
                cluster,
                reason: fill.reason
            };
        }
    }
    return {
        outside: !playerInCluster(cluster, wx, wz),
        seed,
        tiles: cluster,
        cluster,
        reason: `flood-${fill.reason}`
    };
}

export function buildRoofText(args: {
    wx: number;
    wz: number;
    baseX: number;
    baseZ: number;
    pick: RoofHousePick;
    groundh: Int32Array[][] | null;
    world: World | null;
    mapl: Uint8Array[][] | null;
}): string {
    const { wx, wz, baseX, baseZ, pick } = args;
    const lines: string[] = [];
    lines.push(
        `ROOF-HOUSE outside=${pick.outside ? 'yes' : 'no'} player=${wx},${wz} scan=${ROOF_SCAN} seed=${pick.seed.x},${pick.seed.z} tiles=${pick.tiles.length} reason=${pick.reason}`
    );
    lines.push('SOURCE locshape=12-21 addLoc=scenery>=12 mapl=RemoveRoof');
    lines.push('');
    const roofTiles = padTiles(pick.tiles.length > 0 ? pick.tiles : pick.cluster, 2);
    const roofs: HouseLoc[] = [];
    if (args.world) {
        for (let level = 0; level < BuildArea.LEVELS; level++) {
            roofs.push(...collectHouseLocs(args.world, baseX, baseZ, roofTiles, level, true));
        }
    }
    roofs.sort((a, b) => a.z - b.z || a.x - b.x || a.level - b.level || a.type - b.type);
    lines.push('ROOFS');
    if (roofs.length === 0) {
        lines.push('2004 gap — do not invent');
    } else {
        for (const loc of roofs) {
            const h = heightAt(args.groundh, loc.level, loc.x - baseX, loc.z - baseZ);
            lines.push(locLine(loc, avgHeightM(h)));
        }
    }
    lines.push('');
    lines.push('COVER');
    let coverN = 0;
    if (args.mapl) {
        for (const t of roofTiles) {
            const lx = t.x - baseX;
            const lz = t.z - baseZ;
            if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) {
                continue;
            }
            for (let level = 0; level < BuildArea.LEVELS; level++) {
                const flags = args.mapl[level]?.[lx]?.[lz] ?? 0;
                if ((flags & MapFlag.RemoveRoof) === 0) {
                    continue;
                }
                lines.push(`tile ${t.x},${t.z} level=${level} mapl=${flags}`);
                coverN++;
            }
        }
    }
    if (coverN === 0) {
        lines.push('(none)');
    }
    lines.push('');
    lines.push('VR');
    lines.push('roof-only — do not invent locs');
    lines.push('shape 12-21 only');
    return `${lines.join('\n')}\n`;
}
