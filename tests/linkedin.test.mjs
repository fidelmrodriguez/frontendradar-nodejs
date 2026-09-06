import test from 'node:test';
import assert from 'node:assert/strict';
import { isFrontTitle, parseSearchHtml } from '../netlify/functions/_lib/linkedin.mjs';

test('aceita cargos front-end explícitos', () => {
  assert.equal(isFrontTitle('Desenvolvedor Front-End Angular'), true);
  assert.equal(isFrontTitle('Frontend React Developer'), true);
});

test('rejeita fullstack e backend', () => {
  assert.equal(isFrontTitle('Fullstack React / Node Developer'), false);
  assert.equal(isFrontTitle('Backend Java Developer'), false);
});


test('rejeita cargos mistos de .NET com framework frontend quando não são explicitamente Front-End', () => {
  assert.equal(isFrontTitle('Net e Angular Sr (Inglês avançado)'), false);
  assert.equal(isFrontTitle('.NET e Angular Sr'), false);
  assert.equal(isFrontTitle('ASP.NET + Angular Developer'), false);
  assert.equal(isFrontTitle('Angular Developer'), true);
});

test('IDs diferentes são mantidos mesmo com título e empresa iguais', () => {
  const html = `
    <ul>
      <li><div class="base-card" data-entity-urn="urn:li:jobPosting:111"><a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/teste-111/">Frontend Developer</a><h4 class="base-search-card__subtitle">Empresa X</h4><span class="job-search-card__location">Brasil</span><time datetime="2026-08-27">há 1 dia</time></div></li>
      <li><div class="base-card" data-entity-urn="urn:li:jobPosting:222"><a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/teste-222/">Frontend Developer</a><h4 class="base-search-card__subtitle">Empresa X</h4><span class="job-search-card__location">Brasil</span><time datetime="2026-08-27">há 1 dia</time></div></li>
    </ul>`;

  const parsed = parseSearchHtml(html);
  assert.equal(parsed.jobs.length, 2);
  assert.deepEqual(parsed.jobs.map(job => job.id), ['111', '222']);
});
