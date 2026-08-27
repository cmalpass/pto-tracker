(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.PTOYearSelects = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const SPAN_BEFORE = 1;
    const SPAN_AFTER = 3;

    // Years offered by a year <select>: one year before the centered
    // (current PTO) year through three years after it.
    function yearOptionsFor(centerYear) {
        const center = Number(centerYear);
        if (!Number.isInteger(center)) {
            throw new TypeError('centerYear must be an integer');
        }
        const options = [];
        for (let year = center - SPAN_BEFORE; year <= center + SPAN_AFTER; year += 1) {
            options.push(year);
        }
        return options;
    }

    // Rebuilds the options of a year <select> around `centerYear` so the
    // current PTO year stays selectable even after the hardcoded HTML
    // options go stale. When the computed range is already fully present
    // and the select holds a value, the existing selection is preserved,
    // which keeps repeated loads (tab switches, storage refreshes)
    // non-destructive.
    function populateYearSelect(select, centerYear) {
        if (!select) return;
        const values = yearOptionsFor(centerYear);
        const existing = Array.from(select.options).map(option => option.value);
        if (select.value && values.every(value => existing.includes(String(value)))) {
            return;
        }
        select.innerHTML = '';
        const center = Number(centerYear);
        values.forEach(value => {
            const option = document.createElement('option');
            option.value = String(value);
            option.textContent = String(value);
            option.selected = value === center;
            select.appendChild(option);
        });
        if (!select.value) {
            select.value = String(center);
        }
    }

    return {
        yearOptionsFor,
        populateYearSelect
    };
}));
