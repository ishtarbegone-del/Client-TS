const INGEST = 'http://127.0.0.1:43596/capture';

export default class RefAnimLog {
    static on = false;
    static session = '';
    static startWx = 0;
    static startWz = 0;
    static tick = 0;
    static warned = false;
    static busy = false;
    static notify: ((msg: string) => void) | null = null;

    static toggle(wx: number, wz: number, chat: (msg: string) => void): boolean {
        this.on = !this.on;
        this.notify = chat;
        if (this.on) {
            const now = new Date();
            const pad = (n: number): string => String(n).padStart(2, '0');
            this.session = `anim-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
            this.startWx = wx;
            this.startWz = wz;
            this.tick = 0;
            this.warned = false;
            this.busy = false;
            chat(`anim log on ${this.session} at ${wx},${wz}`);
            console.log(`anim log on ${this.session}`);
        } else {
            chat(`anim log off after ${this.tick} ticks`);
            console.log('anim log off');
        }
        return this.on;
    }

    static async logTick(loopCycle: number, dump: string): Promise<void> {
        if (!this.on || this.busy) {
            return;
        }
        this.busy = true;
        this.tick++;
        try {
            const res = await fetch(INGEST, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind: 'anim',
                    session: this.session,
                    tick: this.tick,
                    wx: this.startWx,
                    wz: this.startWz,
                    loopCycle,
                    dump
                })
            });
            if (!res.ok && !this.warned) {
                this.warned = true;
                console.warn('anim log ingest rejected', res.status);
                this.notify?.(`ingest rejected ${res.status} — start LostCityRef.bat`);
            }
        } catch {
            if (!this.warned) {
                this.warned = true;
                console.warn('anim log ingest down — start LostCityRef.bat');
                this.notify?.('ingest down — start LostCityRef.bat');
            }
        } finally {
            this.busy = false;
        }
    }
}
