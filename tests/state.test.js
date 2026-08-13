const test = require('node:test');
const assert = require('node:assert/strict');

function storageWith(value) {
    const values = new Map([['pto-suggestion-filters', value]]);
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, next) => values.set(key, String(next)),
        removeItem: key => values.delete(key)
    };
}

test('recovers from malformed persisted suggestion filters', async () => {
    global.localStorage = storageWith('{not valid json');
    const module = await import(`../static/js/modules/state.js?malformed=${Date.now()}`);

    assert.deepEqual(module.state.suggestionFilters, {
        categories: [],
        sortBy: 'impact'
    });
    assert.equal(global.localStorage.getItem('pto-suggestion-filters'), null);
});

test('normalizes persisted suggestion filter values', async () => {
    global.localStorage = storageWith(JSON.stringify({
        minPto: '2',
        maxPto: 'bad',
        categories: ['holiday-bridge', 2],
        sortBy: 'date'
    }));
    const module = await import(`../static/js/modules/state.js?valid=${Date.now()}`);

    assert.deepEqual(module.state.suggestionFilters, {
        minPto: 2,
        maxPto: null,
        minImpact: null,
        monthStart: null,
        monthEnd: null,
        categories: ['holiday-bridge'],
        sortBy: 'date'
    });
});
