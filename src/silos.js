export class SiloFuel {
  constructor(monitor) {
    this.monitor = monitor;
    this.visible = false;
    this.phase = 'standby';
    this.observer = new IntersectionObserver(entries => {
      this.visible = entries[0].isIntersecting;
      this.update();
    });
    this.observer.observe(monitor);
    document.addEventListener('visibilitychange', () => this.update());
  }

  setPhase(phase) { this.phase = phase; this.update(); }

  launch() { this.monitor.dataset.missilesLaunched = 'true'; this.update(); }

  update() {
    const held = ['launching', 'destruction', 'signal-lost', 'resolved', 'failed'].includes(this.phase);
    const launched = this.phase === 'failed' || this.monitor.dataset.missilesLaunched === 'true';
    this.monitor.dataset.fuelActive = String(this.visible && !document.hidden && !held);
    const status = launched ? 'TANKS EMPTY / LAUNCHED'
      : this.phase === 'resolved' ? 'FUEL TRANSFER / HALTED'
      : this.phase === 'launching' ? 'TANKS FULL / ARMED' : 'FUEL TRANSFER / ACTIVE';
    this.monitor.querySelector('.fuel-status').textContent = status;
    for (const label of this.monitor.querySelectorAll('.silo-unit>b')) {
      label.textContent = launched ? 'LAUNCHED' : this.phase === 'resolved' ? 'HOLD' : this.phase === 'launching' ? 'ARMED' : 'FUELING';
    }
  }
}
