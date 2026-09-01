(function () {
  'use strict';

  var report = window.__REPORT__;
  var rows = report.opportunities;
  var totals = report.totals;

  var tip = document.getElementById('tip');

  function showTip(html, event) {
    tip.innerHTML = html;
    tip.style.opacity = '1';
    moveTip(event);
  }

  function moveTip(event) {
    var pad = 14;
    var rect = tip.getBoundingClientRect();
    var x = event.clientX + pad;
    var y = event.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - pad;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }

  function hideTip() {
    tip.style.opacity = '0';
  }

  /** Hover layer: every mark gets a tooltip, hit target is the whole row. */
  function bindTip(el, html) {
    el.addEventListener('mouseenter', function (e) { showTip(html, e); });
    el.addEventListener('mousemove', moveTip);
    el.addEventListener('mouseleave', hideTip);
  }

  function num(value) {
    return (value || 0).toLocaleString();
  }

  var CURRENCY = report.currency || 'USD';
  function money(value) {
    try {
      return (value || 0).toLocaleString(undefined, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 });
    } catch (e) {
      return CURRENCY + ' ' + Math.round(value || 0).toLocaleString();
    }
  }

  function pct(value) {
    return value === null || value === undefined ? '—' : Math.round(value * 100) + '%';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Single-series horizontal bars: one measure, one color. */
  function renderBars(mountId, buckets, valueOf, tooltipOf) {
    var mount = document.getElementById(mountId);
    if (!mount) return;
    mount.innerHTML = '';
    if (!buckets.length) {
      mount.appendChild(el('div', 'empty', 'No data in range.'));
      return;
    }
    var max = Math.max.apply(null, buckets.map(valueOf).concat([1]));
    buckets.forEach(function (bucket) {
      var row = el('div', 'bar-row');
      var name = el('div', 'name', bucket.key);
      name.title = bucket.key;
      var track = el('div', 'track');
      var fill = el('div', 'fill s1');
      fill.style.width = Math.max(2, (valueOf(bucket) / max) * 100) + '%';
      track.appendChild(fill);
      row.appendChild(name);
      row.appendChild(track);
      row.appendChild(el('div', 'val', num(valueOf(bucket))));
      bindTip(row, tooltipOf(bucket));
      mount.appendChild(row);
    });
  }

  /** Two-series grouped bars sharing one scale, so the pair is comparable. */
  function renderGroupedBars(mountId, buckets) {
    var mount = document.getElementById(mountId);
    if (!mount) return;
    mount.innerHTML = '';
    var withCalls = buckets.filter(function (b) { return b.callsTotal > 0; });
    if (!withCalls.length) {
      mount.appendChild(el('div', 'empty', 'No calls recorded in range.'));
      return;
    }
    var max = Math.max.apply(null, withCalls.map(function (b) {
      return Math.max(b.callsInbound, b.callsOutbound);
    }).concat([1]));

    withCalls.forEach(function (bucket) {
      var row = el('div', 'bar-row');
      var name = el('div', 'name', bucket.key);
      name.title = bucket.key;
      var group = el('div', 'group');
      [['s1', bucket.callsInbound], ['s2', bucket.callsOutbound]].forEach(function (pair) {
        var track = el('div', 'track');
        var fill = el('div', 'fill ' + pair[0]);
        fill.style.width = Math.max(pair[1] > 0 ? 2 : 0, (pair[1] / max) * 100) + '%';
        track.appendChild(fill);
        group.appendChild(track);
      });
      row.appendChild(name);
      row.appendChild(group);
      row.appendChild(el('div', 'val', num(bucket.callsTotal)));
      bindTip(row,
        '<strong>' + escapeHtml(bucket.key) + '</strong>' +
        '<div class="row">Inbound: ' + num(bucket.callsInbound) + '</div>' +
        '<div class="row">Outbound: ' + num(bucket.callsOutbound) + '</div>' +
        '<div class="row">Opportunities: ' + num(bucket.opportunities) + '</div>');
      mount.appendChild(row);
    });
  }

  function sourceTooltip(bucket) {
    return '<strong>' + escapeHtml(bucket.key) + '</strong>' +
      '<div class="row">Opportunities: ' + num(bucket.opportunities) + '</div>' +
      '<div class="row">Form submissions: ' + num(bucket.formSubmissions) + '</div>' +
      '<div class="row">Calls: ' + num(bucket.callsInbound) + ' in / ' + num(bucket.callsOutbound) + ' out</div>' +
      '<div class="row">Value: ' + money(bucket.monetaryValue) + '</div>' +
      '<div class="row">Win rate: ' + pct(bucket.winRate) + '</div>';
  }

  function stageTooltip(bucket) {
    return '<strong>' + escapeHtml(bucket.key) + '</strong>' +
      '<div class="row">Opportunities: ' + num(bucket.opportunities) + '</div>' +
      '<div class="row">Value: ' + money(bucket.monetaryValue) + '</div>' +
      '<div class="row">Calls: ' + num(bucket.callsTotal) + '</div>' +
      '<div class="row">Form submissions: ' + num(bucket.formSubmissions) + '</div>';
  }

  renderBars('chart-source', totals.bySource, function (b) { return b.opportunities; }, sourceTooltip);
  renderGroupedBars('chart-calls', totals.bySource);
  renderBars('chart-stage', totals.byStage, function (b) { return b.opportunities; }, stageTooltip);
  renderBars('chart-forms',
    totals.bySource.filter(function (b) { return b.formSubmissions > 0; }),
    function (b) { return b.formSubmissions; }, sourceTooltip);

  // ---- Detail table -------------------------------------------------------

  var COLUMNS = [
    { key: 'opportunityName', label: 'Opportunity', get: function (r) { return r.opportunityName || '(unnamed)'; } },
    { key: 'contactName', label: 'Contact', get: function (r) { return r.contactName || '—'; } },
    { key: 'stage', label: 'Stage', get: function (r) { return r.stage; } },
    { key: 'status', label: 'Status', get: function (r) { return r.status; }, cell: statusCell },
    { key: 'source', label: 'Lead source', get: function (r) { return r.leadSource.source; }, cell: tagCell },
    { key: 'channel', label: 'Channel', get: function (r) { return r.leadSource.channel; } },
    { key: 'inbound', label: 'In', num: true, get: function (r) { return r.calls.inbound; } },
    { key: 'outbound', label: 'Out', num: true, get: function (r) { return r.calls.outbound; } },
    { key: 'forms', label: 'Forms', num: true, get: function (r) { return r.forms.submissions; } },
    { key: 'value', label: 'Value', num: true, get: function (r) { return r.monetaryValue; }, cell: function (r) { return money(r.monetaryValue); } },
    { key: 'createdAt', label: 'Created', get: function (r) { return r.createdAt || ''; }, cell: dateCell },
  ];

  function statusCell(row) {
    var span = el('span', String(row.status).toLowerCase() === 'won' ? 'status-won' : '', row.status);
    return span;
  }

  function tagCell(row) {
    return el('span', 'tag', row.leadSource.source);
  }

  function dateCell(row) {
    if (!row.createdAt) return '—';
    var d = new Date(row.createdAt);
    return isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
  }

  var sortKey = 'createdAt';
  var sortDir = -1;
  var search = document.getElementById('f-search');
  var sourceSel = document.getElementById('f-source');
  var stageSel = document.getElementById('f-stage');

  function fillSelect(select, values, allLabel) {
    select.appendChild(new Option(allLabel, ''));
    values.forEach(function (value) { select.appendChild(new Option(value, value)); });
  }

  fillSelect(sourceSel, totals.bySource.map(function (b) { return b.key; }), 'All lead sources');
  fillSelect(stageSel, totals.byStage.map(function (b) { return b.key; }), 'All stages');

  function visibleRows() {
    var q = search.value.trim().toLowerCase();
    var source = sourceSel.value;
    var stage = stageSel.value;
    return rows.filter(function (row) {
      if (source && row.leadSource.source !== source) return false;
      if (stage && row.stage !== stage) return false;
      if (!q) return true;
      return [row.opportunityName, row.contactName, row.email, row.phone, row.leadSource.source]
        .filter(Boolean).join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderTable() {
    var column = COLUMNS.filter(function (c) { return c.key === sortKey; })[0] || COLUMNS[0];
    var data = visibleRows().slice().sort(function (a, b) {
      var av = column.get(a);
      var bv = column.get(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });

    var head = document.getElementById('thead');
    head.innerHTML = '';
    var tr = el('tr');
    COLUMNS.forEach(function (col) {
      var th = el('th', col.num ? 'num' : '', col.label);
      th.setAttribute('scope', 'col');
      if (col.key === sortKey) th.setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending');
      th.addEventListener('click', function () {
        if (sortKey === col.key) sortDir = -sortDir;
        else { sortKey = col.key; sortDir = col.num ? -1 : 1; }
        renderTable();
      });
      tr.appendChild(th);
    });
    head.appendChild(tr);

    var body = document.getElementById('tbody');
    body.innerHTML = '';
    data.forEach(function (row) {
      var line = el('tr');
      COLUMNS.forEach(function (col) {
        var td = el('td', col.num ? 'num' : '');
        var content = col.cell ? col.cell(row) : col.get(row);
        if (content instanceof Node) td.appendChild(content);
        else td.textContent = col.num ? num(content) : String(content);
        line.appendChild(td);
      });
      body.appendChild(line);
    });

    document.getElementById('row-count').textContent =
      data.length + ' of ' + rows.length + ' opportunities shown';
  }

  [search, sourceSel, stageSel].forEach(function (control) {
    control.addEventListener('input', renderTable);
  });
  renderTable();
})();
