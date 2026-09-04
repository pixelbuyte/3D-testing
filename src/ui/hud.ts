/** Minimal cinematic HUD: objective, interaction prompt, toasts, letterbox, fades, finale card. */
export class HUD {
  private root = document.getElementById('hud')!;
  private objective = document.getElementById('objective')!;
  private objectiveText = this.objective.querySelector<HTMLElement>('.text')!;
  private prompt = document.getElementById('prompt')!;
  private promptLabel = this.prompt.querySelector<HTMLElement>('.label')!;
  private crosshair = document.getElementById('crosshair')!;
  private toast = document.getElementById('toast')!;
  private letterbox = document.getElementById('letterbox')!;
  private fade = document.getElementById('fade')!;
  private finale = document.getElementById('finale')!;
  private toastTimer = 0;
  private objTimer = 0;
  private damage = document.getElementById('damage');
  private vitals = document.getElementById('vitals');
  private vitalsFill = this.vitals?.querySelector<HTMLElement>('.fill') ?? null;
  private dmgTimer = 0;

  show(): void { this.root.hidden = false; }
  hide(): void { this.root.hidden = true; }

  setObjective(text: string, holdSeconds = 7): void {
    this.objectiveText.textContent = text;
    this.objective.classList.add('show');
    clearTimeout(this.objTimer);
    if (holdSeconds > 0) this.objTimer = window.setTimeout(() => this.objective.classList.remove('show'), holdSeconds * 1000);
  }
  flashObjective(): void { this.objective.classList.add('show'); clearTimeout(this.objTimer); this.objTimer = window.setTimeout(() => this.objective.classList.remove('show'), 5000); }

  setPrompt(label: string | null): void {
    if (label) { this.promptLabel.textContent = label; this.prompt.hidden = false; requestAnimationFrame(() => this.prompt.classList.add('show')); this.crosshair.classList.add('hot'); }
    else { this.prompt.classList.remove('show'); this.crosshair.classList.remove('hot'); setTimeout(() => { if (!this.prompt.classList.contains('show')) this.prompt.hidden = true; }, 350); }
  }

  showToast(text: string, seconds = 4): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), seconds * 1000);
  }

  /** Red vignette pulse when the player takes a hit. */
  flashDamage(): void {
    if (!this.damage) return;
    this.damage.classList.add('show');
    clearTimeout(this.dmgTimer);
    this.dmgTimer = window.setTimeout(() => this.damage?.classList.remove('show'), 240);
  }

  /** Show the combat vitals bar only while a fight is live. */
  setVitals(visible: boolean, health01: number): void {
    if (!this.vitals) return;
    this.vitals.classList.toggle('show', visible);
    if (this.vitalsFill) this.vitalsFill.style.transform = `scaleX(${Math.max(0, Math.min(1, health01))})`;
  }

  setLetterbox(on: boolean): void { this.letterbox.classList.toggle('show', on); }
  setCrosshair(on: boolean): void { this.crosshair.style.opacity = on ? '' : '0'; }
  fadeIn(): void { this.fade.classList.add('clear'); }
  fadeOut(): void { this.fade.classList.remove('clear'); }
  showFinale(onAgain: () => void): void {
    this.finale.hidden = false;
    requestAnimationFrame(() => this.finale.classList.add('show'));
    this.finale.querySelector<HTMLButtonElement>('.again')!.onclick = onAgain;
  }
  hideFinale(): void { this.finale.classList.remove('show'); setTimeout(() => (this.finale.hidden = true), 1500); }
}
