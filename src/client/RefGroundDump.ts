import { BuildArea } from '#/dash3d/CollisionMap.js';
import { ROOF_SCAN } from '#/client/HouseBlueprint.js';
import type World from '#/dash3d/World.js';
import type ClientObj from '#/dash3d/ClientObj.js';
import type GroundObject from '#/dash3d/GroundObject.js';
import type LinkList from '#/datastruct/LinkList.js';
import type Model from '#/dash3d/Model.js';
import ObjType from '#/config/ObjType.js';

const RADIUS = ROOF_SCAN;

export type GroundDumpCtx = {
    wx: number;
    wz: number;
    mapBuildBaseX: number;
    mapBuildBaseZ: number;
    level?: number;
    world: World | null;
    groundObj?: (LinkList<ClientObj> | null)[][][] | null;
};

type GroundRole = 'top' | 'middle' | 'bottom';

type GroundItem = {
    wx: number;
    wz: number;
    level: number;
    id: number;
    name: string;
    count: number;
    model: number;
    role: GroundRole;
    y: number;
    x: number;
    z: number;
    stackH: number;
};

function listObjs(list: LinkList<ClientObj>): ClientObj[] {
    const out: ClientObj[] = [];
    for (let obj = list.head(); obj !== null; obj = list.next()) {
        out.push(obj);
    }
    return out;
}

function objCost(obj: ClientObj): number {
    try {
        const type = ObjType.list(obj.id);
        let cost = type.cost;
        if (type.stackable) {
            cost *= obj.count + 1;
        }
        return cost;
    } catch {
        return 0;
    }
}

function pickRoles(objs: ClientObj[]): { role: GroundRole; obj: ClientObj }[] {
    if (objs.length === 0) {
        return [];
    }
    let top = objs[0];
    let topCost = -99999999;
    for (const obj of objs) {
        const cost = objCost(obj);
        if (cost > topCost) {
            topCost = cost;
            top = obj;
        }
    }
    let bottom: ClientObj | null = null;
    let middle: ClientObj | null = null;
    for (const obj of objs) {
        if (obj.id !== top.id && !bottom) {
            bottom = obj;
            continue;
        }
        if (obj.id !== top.id && bottom && obj.id !== bottom.id && !middle) {
            middle = obj;
        }
    }
    const rows: { role: GroundRole; obj: ClientObj }[] = [{ role: 'top', obj: top }];
    if (bottom) {
        rows.push({ role: 'bottom', obj: bottom });
    }
    if (middle) {
        rows.push({ role: 'middle', obj: middle });
    }
    return rows;
}

function poseOf(go: GroundObject | null, lx: number, lz: number): { x: number; y: number; z: number; stackH: number } {
    if (go) {
        return { x: go.x, y: go.y, z: go.z, stackH: go.height };
    }
    return { x: lx * 128 + 64, y: 0, z: lz * 128 + 64, stackH: 0 };
}

function collectGround(ctx: GroundDumpCtx): GroundItem[] {
    const level = ctx.level ?? 0;
    const grid = ctx.groundObj;
    if (!grid) {
        return [];
    }
    const items: GroundItem[] = [];
    for (let wz = ctx.wz - RADIUS; wz <= ctx.wz + RADIUS; wz++) {
        for (let wx = ctx.wx - RADIUS; wx <= ctx.wx + RADIUS; wx++) {
            const lx = wx - ctx.mapBuildBaseX;
            const lz = wz - ctx.mapBuildBaseZ;
            if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) {
                continue;
            }
            const list = grid[level]?.[lx]?.[lz];
            if (!list) {
                continue;
            }
            const objs = listObjs(list);
            if (objs.length === 0) {
                continue;
            }
            const go = ctx.world?.squareAt(level, lx, lz)?.groundObject ?? null;
            const pose = poseOf(go, lx, lz);
            for (const row of pickRoles(objs)) {
                let name = `#${row.obj.id}`;
                let model = -1;
                try {
                    const type = ObjType.list(row.obj.id);
                    name = type.name ?? name;
                    model = type.model;
                } catch {
                    // keep defaults
                }
                items.push({
                    wx,
                    wz,
                    level,
                    id: row.obj.id,
                    name,
                    count: row.obj.count,
                    model,
                    role: row.role,
                    y: pose.y,
                    x: pose.x,
                    z: pose.z,
                    stackH: pose.stackH
                });
            }
        }
    }
    return items;
}

function loadGroundModel(id: number, count: number): { modelId: number; mesh: Model } | null {
    try {
        const type = ObjType.list(id);
        const mesh = type.getModelLit(count);
        if (!mesh) {
            return null;
        }
        return { modelId: type.model, mesh };
    } catch {
        return null;
    }
}

export function buildGroundObjs(ctx: GroundDumpCtx): string {
    const lines: string[] = ['GROUND-OBJS', 'pipeline ground=getModelLit+worldRender yaw=0'];
    const items = collectGround(ctx);
    if (items.length === 0) {
        lines.push('(none)');
        return lines.join('\n') + '\n';
    }
    for (const item of items) {
        lines.push(
            `obj wx=${item.wx} wz=${item.wz} level=${item.level} id=${item.id} name=${item.name} count=${item.count} model=${item.model} role=${item.role} y=${item.y} x=${item.x} z=${item.z} stackH=${item.stackH}`
        );
    }
    return lines.join('\n') + '\n';
}

export function buildGroundVerts(ctx: GroundDumpCtx): string {
    const lines: string[] = ['GROUND-VERTS'];
    const items = collectGround(ctx);
    if (items.length === 0) {
        lines.push('(none)');
        return lines.join('\n') + '\n';
    }
    const seen = new Set<string>();
    for (const item of items) {
        const key = `${item.id}:${item.count}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const loaded = loadGroundModel(item.id, item.count);
        if (!loaded) {
            lines.push(`item wx=${item.wx} wz=${item.wz} id=${item.id} name=${item.name} kind=ground model=- points=0 faces=0`);
            continue;
        }
        const m = loaded.mesh;
        lines.push(
            `item wx=${item.wx} wz=${item.wz} id=${item.id} name=${item.name} kind=ground model=${loaded.modelId} points=${m.numPoints} faces=${m.numFaces}`
        );
        for (let i = 0; i < m.numPoints; i++) {
            lines.push(`v ${i} ${m.pointX[i]} ${m.pointY[i]} ${m.pointZ[i]}`);
        }
        for (let i = 0; i < m.numFaces; i++) {
            const hsl = m.faceColour ? m.faceColour[i] : -1;
            lines.push(`f ${i} ${m.faceVertexA[i]} ${m.faceVertexB[i]} ${m.faceVertexC[i]} ${hsl}`);
        }
    }
    return lines.join('\n') + '\n';
}
