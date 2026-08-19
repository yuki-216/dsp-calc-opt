export default function OreQuantityModeToggle({ mode, onChange }) {
    return (
        <div className="pro-mode-toggle" role="radiogroup" aria-label="矿物可用量模式">
            <div
                className={`pro-mode-option pro-mode-extra-products ${mode === 'amount' ? 'pro-mode-active' : ''}`}
                role="radio"
                aria-checked={mode === 'amount'}
                tabIndex={0}
                onClick={() => onChange('amount')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onChange('amount'); }}
            >
                矿量
            </div>
            <div
                className={`pro-mode-option pro-mode-speedup ${mode === 'point' ? 'pro-mode-active' : ''}`}
                role="radio"
                aria-checked={mode === 'point'}
                tabIndex={0}
                onClick={() => onChange('point')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onChange('point'); }}
            >
                矿点
            </div>
        </div>
    );
}
