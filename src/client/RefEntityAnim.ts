import SeqType from '#/config/SeqType.js';
import type ClientNpc from '#/dash3d/ClientNpc.js';
import type ClientPlayer from '#/dash3d/ClientPlayer.js';

function sanitize(s: string | null | undefined): string {
    return s && s.length > 0 ? s.replace(/\s+/g, '_') : '-';
}

function seqOf(id: number): SeqType | null {
    if (id < 0 || id >= SeqType.list.length) {
        return null;
    }
    return SeqType.list[id] ?? null;
}

export function seqFrameId(seqId: number, frameIndex: number): number {
    const seq = seqOf(seqId);
    if (!seq?.frames || frameIndex < 0 || frameIndex >= seq.frames.length) {
        return -1;
    }
    return seq.frames[frameIndex];
}

export function seqDelayAt(seqId: number, frameIndex: number): number {
    const seq = seqOf(seqId);
    if (!seq?.delay || frameIndex < 0 || frameIndex >= seq.delay.length) {
        return -1;
    }
    return seq.delay[frameIndex];
}

export function seqHasWalkmerge(seqId: number): boolean {
    const seq = seqOf(seqId);
    return Boolean(seq?.walkmerge && seq.walkmerge.length > 0);
}

export function seqDumpLine(seqId: number): string {
    const seq = seqOf(seqId);
    if (!seq) {
        return `seq id=${seqId} missing`;
    }
    const frames = seq.frames ? Array.from(seq.frames).join(',') : '';
    const delays = seq.delay ? Array.from(seq.delay).join(',') : '';
    const n = seq.numFrames;
    return `seq id=${seqId} frames=${n} delays=${delays} frameIds=${frames} walkmerge=${seqHasWalkmerge(seqId) ? 'yes' : 'no'}`;
}

function modelsNpc(npc: ClientNpc): string {
    const models = npc.type?.model;
    if (!models || models.length === 0) {
        return '-';
    }
    return Array.from(models).join(',');
}

function kitPlayer(player: ClientPlayer): string {
    return Array.from(player.appearance).join(',');
}

function entityBits(
    ready: number,
    typeReady: number,
    typeWalk: number,
    models: string,
    primary: number,
    primaryFrame: number,
    primaryDelay: number,
    primaryCycle: number,
    secondary: number,
    secondaryFrame: number,
    secondaryCycle: number,
    spot: number,
    spotFrame: number,
    yaw: number,
    moving: boolean
): string {
    const primaryFrameId = seqFrameId(primary, primaryFrame);
    const secondaryFrameId = seqFrameId(secondary, secondaryFrame);
    const seqDelay = seqDelayAt(primary >= 0 ? primary : secondary, primary >= 0 ? primaryFrame : secondaryFrame);
    const mergeId = primary >= 0 ? primary : secondary;
    return (
        ` moving=${moving ? 'yes' : 'no'}` +
        ` ready=${ready} typeReady=${typeReady} typeWalk=${typeWalk}` +
        ` models=${models}` +
        ` primary=${primary} primaryFrame=${primaryFrame} primaryFrameId=${primaryFrameId}` +
        ` primaryDelay=${primaryDelay} seqDelay=${seqDelay} primaryCycle=${primaryCycle}` +
        ` secondary=${secondary} secondaryFrame=${secondaryFrame} secondaryFrameId=${secondaryFrameId}` +
        ` secondaryCycle=${secondaryCycle}` +
        ` walkmerge=${seqHasWalkmerge(mergeId) ? 'yes' : 'no'}` +
        ` spot=${spot} spotFrame=${spotFrame}` +
        ` yaw=${yaw}`
    );
}

export function playerAnimLine(index: number, player: ClientPlayer, mapBuildBaseX: number, mapBuildBaseZ: number): string {
    const px = (player.x >> 7) + mapBuildBaseX;
    const pz = (player.z >> 7) + mapBuildBaseZ;
    return (
        `player slot=${index} name=${sanitize(player.name)} at ${px},${pz}` +
        entityBits(
            player.readyanim,
            player.readyanim,
            player.walkanim,
            kitPlayer(player),
            player.primaryAnim,
            player.primaryAnimFrame,
            player.primaryAnimDelay,
            player.primaryAnimCycle,
            player.secondaryAnim,
            player.secondaryAnimFrame,
            player.secondaryAnimCycle,
            player.spotanimId,
            player.spotanimFrame,
            player.yaw,
            player.routeLength > 0
        )
    );
}

export function npcAnimLine(index: number, npc: ClientNpc, mapBuildBaseX: number, mapBuildBaseZ: number): string {
    const nx = (npc.x >> 7) + mapBuildBaseX;
    const nz = (npc.z >> 7) + mapBuildBaseZ;
    const type = npc.type;
    return (
        `npc slot=${index} type=${type?.id ?? -1} name=${sanitize(type?.name)} at ${nx},${nz}` +
        entityBits(
            npc.readyanim,
            type?.readyanim ?? -1,
            type?.walkanim ?? -1,
            modelsNpc(npc),
            npc.primaryAnim,
            npc.primaryAnimFrame,
            npc.primaryAnimDelay,
            npc.primaryAnimCycle,
            npc.secondaryAnim,
            npc.secondaryAnimFrame,
            npc.secondaryAnimCycle,
            npc.spotanimId,
            npc.spotanimFrame,
            npc.yaw,
            npc.routeLength > 0
        )
    );
}

export type EntityAnimDump = {
    playerLines: string[];
    npcLines: string[];
    seqLines: string[];
};

export function collectSeqIds(players: ClientPlayer[], npcs: ClientNpc[]): number[] {
    const seen = new Set<number>();
    const add = (id: number): void => {
        if (id >= 0) {
            seen.add(id);
        }
    };
    for (const player of players) {
        add(player.readyanim);
        add(player.walkanim);
        add(player.walkanim_b);
        add(player.walkanim_l);
        add(player.walkanim_r);
        add(player.runanim);
        add(player.primaryAnim);
        add(player.secondaryAnim);
    }
    for (const npc of npcs) {
        add(npc.readyanim);
        add(npc.walkanim);
        add(npc.primaryAnim);
        add(npc.secondaryAnim);
        if (npc.type) {
            add(npc.type.readyanim);
            add(npc.type.walkanim);
            add(npc.type.walkanim_b);
            add(npc.type.walkanim_l);
            add(npc.type.walkanim_r);
        }
    }
    return [...seen].sort((a, b) => a - b);
}

export function formatSeqBlock(ids: number[]): string[] {
    return ids.map(seqDumpLine);
}
