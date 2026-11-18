// Minoshek built this with help from AI.

// Tipp-Hinweise (alle paar Minuten, auf allen Schulnetz-Seiten) und der Teilen-Button (nur Notenseite).
// Der Teilen-Button ist ein normaler Button in der Leiste von PanumDock, kein eigener runder Knopf mehr.

(function () {
    const ENABLE_SHARE_TRIGGER = true;
    const GRADES_PAGE_ID = '21311';
    const WEBSITE_URL = 'https://panumic.com/grades/';

    function isGradesPage() {
        const currentUrl = new URL(window.location.href);
        return currentUrl.searchParams.get('pageid') === GRADES_PAGE_ID;
    }

    const TIPS = [
        "Wusstest du: Du kannst einzelne Buttons im <span class='highlight-popup'>Erweiterungs-Popup</span> an- und ausschalten?",
        "Wusstest du: Deine Daten werden sicher lokal in deinem Browser gespeichert?",
        "Wusstest du: Im Popup kannst du unter «Anordnung» festlegen, welche Buttons unten und welche rechts stehen?",
        "Wusstest du: Die Pluspunkte gibt es als Button und direkt in der Notentabelle. Beides schaltest du im <span class='highlight-popup'>Erweiterungs-Popup</span> einzeln ein und aus.",
        "Wusstest du: Im Notenrechner kannst du Probe-Noten eintragen und siehst sofort den neuen Schnitt?",
        "Wusstest du: Der Notenrechner sagt dir, welche Note du für deinen Wunsch-Schnitt brauchst?",
        "Wusstest du: Diese Erweiterung wird ständig weiterentwickelt – Feedback ist willkommen!",
        "Wusstest du: Über «Fächer verbinden» zählen zwei Fächer zusammen als eine Note, zum Beispiel im Schwerpunktfach?",
        "Wusstest du: Du kannst die Erweiterung auf Chrome, Edge und Firefox nutzen?",
        "Wusstest du: Wenn dich ein Button stört, schalte ihn einfach im Menü oben rechts aus.",
        "Wusstest du: Der Durchschnitt wird automatisch basierend auf deinen eingetragenen Noten aktualisiert?",
        "Wusstest du: Unter «Chancen und Risiken» siehst du, wo dir wenig zur nächsten halben Note fehlt?",
        "Wusstest du: Mit Achievements wird das Notensammeln etwas spannender!",
        "Wusstest du: Du kannst diesen Hinweis schließen, indem du kurz wartest oder ihn wegklickst."
    ];

    const SHARE_ICON = '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="20" height="20" rx="4" fill="#546e7a"/><path d="M10.5 14l7-3.8M10.5 14l7 3.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><circle cx="10.5" cy="14" r="2.3" fill="#fff"/><circle cx="17.5" cy="10.2" r="2.3" fill="#fff"/><circle cx="17.5" cy="17.8" r="2.3" fill="#fff"/></svg>';

    class ToastSystem {
        constructor() {
            this.container = null;
            this.isVisible = false;
            this.hideTimer = null;
            this.minInterval = 2 * 60 * 1000; // 2 minutes
            this.maxInterval = 5 * 60 * 1000; // 5 minutes
            this.displayDuration = 8000; // 8 seconds
        }

        init() {
            this.createStyles();
            if (ENABLE_SHARE_TRIGGER && isGradesPage() && window.PanumDock) {
                this.createShareButton();
            }
            this.createToastContainer();
            this.scheduleNextToast();
        }

        createStyles() {
            const style = document.createElement('style');
            style.textContent = `
                /* Steht über der unteren Button-Reihe (--panum-dock-bottom) und liegt in der Ebene darunter:
                   der Hinweis kann nie einen Button verdecken. */
                .sn-toast-container {
                    position: fixed;
                    bottom: calc(var(--panum-dock-bottom, 20px) + 8px);
                    left: 50%;
                    transform: translateX(-50%) translateY(16px);
                    background: rgba(33, 37, 41, 0.96);
                    color: white;
                    padding: 10px 18px;
                    border-radius: 12px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                    font-family: Roboto, 'Segoe UI', sans-serif;
                    font-size: 14px;
                    z-index: 2147482980;
                    transition: transform 0.2s ease, opacity 0.2s ease, visibility 0s linear 0.2s;
                    opacity: 0;
                    visibility: hidden;
                    pointer-events: none;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    max-width: min(80%, 620px);
                    width: max-content;
                    text-align: left;
                    cursor: pointer;
                }

                html.panum-dark-theme .sn-toast-container { border: 1px solid rgba(255,255,255,0.12); }

                .sn-toast-container.visible {
                    transform: translateX(-50%) translateY(0);
                    opacity: 1;
                    visibility: visible;
                    pointer-events: auto;
                    transition: transform 0.2s ease, opacity 0.2s ease;
                }

                .sn-toast-container, .sn-toast-container span { color: #fff !important; }
                .sn-toast-text { line-height: 1.4; }

                .sn-toast-container .highlight-popup {
                    color: #7cc0ff !important;
                    font-weight: bold;
                    text-decoration: underline;
                    cursor: help;
                }
            `;
            document.head.appendChild(style);
        }

        createShareButton() {
            this.shareBtn = window.PanumDock.add({
                name: 'share',
                title: 'Panum Grades weiterempfehlen',
                color: '#546e7a',
                svg: SHARE_ICON,
                onClick: () => this.openSharePopup()
            });
        }

        openSharePopup() {
            if (document.getElementById('panum-share-dialog')) return;

            const mailBody = encodeURIComponent('Schau dir die Panum Grades Extension an: ' + WEBSITE_URL);
            const overlay = document.createElement('div');
            overlay.id = 'panum-share-dialog';
            overlay.className = 'pg pg-modal-overlay';
            overlay.innerHTML = `
                <div class="pg-modal pg-modal-narrow" role="dialog" aria-label="Panum Grades teilen">
                    <div class="pg-modal-head">
                        <div class="pg-modal-title">Panum Grades teilen</div>
                        <button type="button" class="pg-icon-btn" data-close title="Schliessen">&times;</button>
                    </div>
                    <p class="pg-muted">Geteilt wird nur der Link zur Extension, nie deine Noten.</p>
                    <div class="pg-options">
                        <button type="button" class="pg-option" id="sn-copy-link">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                            <span>Link kopieren</span>
                        </button>
                        <a class="pg-option" target="_blank" rel="noopener" href="https://teams.microsoft.com/share?href=${encodeURIComponent(WEBSITE_URL)}">
                            <svg viewBox="0 0 24 24" fill="#7b83eb"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>
                            <span>Auf Teams teilen</span>
                        </a>
                        <a class="pg-option" target="_blank" rel="noopener" href="https://mail.google.com/mail/?view=cm&fs=1&su=Panum%20Grades%20Extension&body=${mailBody}">
                            <svg viewBox="0 0 24 24" fill="#ea4335"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                            <span>Per Gmail senden</span>
                        </a>
                        <a class="pg-option" target="_blank" rel="noopener" href="https://wa.me/?text=${mailBody}">
                            <svg viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                            <span>Per WhatsApp senden</span>
                        </a>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            const closePopup = () => {
                overlay.remove();
                document.removeEventListener('keydown', onKey, true);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') closePopup();
            };
            document.addEventListener('keydown', onKey, true);
            overlay.querySelector('[data-close]').onclick = closePopup;
            overlay.onclick = (e) => {
                if (e.target === overlay) closePopup();
            };

            const copyButton = overlay.querySelector('#sn-copy-link');
            const copyLabel = copyButton.querySelector('span');
            copyButton.onclick = () => {
                navigator.clipboard.writeText(WEBSITE_URL).then(() => {
                    copyLabel.textContent = 'Kopiert';
                    setTimeout(() => { copyLabel.textContent = 'Link kopieren'; }, 2000);
                }, () => {
                    copyLabel.textContent = WEBSITE_URL;
                });
            };
        }

        createToastContainer() {
            this.container = document.createElement('div');
            this.container.className = 'sn-toast-container';
            this.container.innerHTML = `<span class="sn-toast-text"></span>`;
            this.container.addEventListener('click', () => this.hideToast());
            document.body.appendChild(this.container);
        }

        createHelpModal() {
            const existing = document.querySelector('.sn-help-modal-overlay');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.className = 'pg pg-modal-overlay sn-help-modal-overlay';
            overlay.innerHTML = `
                <div class="pg-modal pg-modal-narrow" role="dialog" aria-label="Einstellungen öffnen">
                    <div class="pg-modal-title">Einstellungen öffnen</div>
                    <p class="pg-muted" style="margin-top: 8px;">Browser-Erweiterungen können ihr Menü aus Sicherheitsgründen nicht selbst öffnen.</p>
                    <p>Klicke oben rechts in der Browser-Leiste auf das <strong>Puzzle-Symbol</strong> und dann auf <strong>Panum Grades</strong>. Dort schaltest du Buttons ein und aus.</p>
                    <div class="pg-modal-foot"><button type="button" class="pg-btn pg-btn-primary">Verstanden</button></div>
                </div>
            `;

            overlay.querySelector('button').onclick = () => overlay.remove();
            overlay.onclick = (e) => {
                if (e.target === overlay) overlay.remove();
            };

            document.body.appendChild(overlay);
        }

        showRandomToast() {
            const randomTip = TIPS[Math.floor(Math.random() * TIPS.length)];
            this.showToast(randomTip);
        }

        showToast(message) {
            if (this.isVisible) return; // Don't overlap

            const textEl = this.container.querySelector('.sn-toast-text');
            textEl.innerHTML = message;

            // Add click handler for the popup link if present
            const popupLink = textEl.querySelector('.highlight-popup');
            if (popupLink) {
                popupLink.onclick = (e) => {
                    e.stopPropagation();
                    this.createHelpModal();
                };
            }

            this.isVisible = true;
            this.container.classList.add('visible');

            clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
                this.hideToast();
            }, this.displayDuration);
        }

        hideToast() {
            this.isVisible = false;
            this.container.classList.remove('visible');
        }

        scheduleNextToast() {
            const nextInterval = Math.floor(Math.random() * (this.maxInterval - this.minInterval + 1) + this.minInterval);
            setTimeout(() => {
                if (!document.hidden) { // Only show if tab is active-ish
                    this.showRandomToast();
                }
                this.scheduleNextToast();
            }, nextInterval);
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new ToastSystem().init());
    } else {
        new ToastSystem().init();
    }

})();
