// dist-artifact/의 빌드 결과를 claude.ai 아티팩트용 단일 HTML 조각으로 묶는다.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-artifact';
const assets = readdirSync(join(dir, 'assets'));
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8'));
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8'));
if (js.length !== 1) throw new Error(`JS 번들이 하나가 아니다: ${js.length}`);
const script = js[0].replaceAll('</script', '<\\/script');

const html = `<title>끄적임 노트</title>
<meta name="description" content="떠오르는 생각을 아무렇게나 던지면 주제별로 모여드는 아이디어 노트">
<style>${css.join('\n')}</style>
<div id="root"></div>
<script type="module">${script}</script>
`;
writeFileSync(join(dir, 'kkeujeogim.html'), html);
console.log(`kkeujeogim.html ${(html.length / 1024).toFixed(0)} KiB`);
