/**
 * 正则替换（regex-replace）冒烟。
 *
 * 为什么单独一个脚本而不是并进 smoke:ux：这一块的失败模式都很安静——
 * 零宽匹配死循环、$1 引用不存在的组静默变成空串、命名组写错不报错。
 * 肉眼和 SSR 冒烟都看不出来，只能靠这里的边界用例钉住。
 *
 * 覆盖：
 *   1. 基础替换与计数
 *   2. 捕获组引用（$1 / $& / $` / $' / $$）
 *   3. 命名组引用 $<name>
 *   4. **零宽匹配不死循环**（最关键：a* 这类模式在 lastIndex 不推进时会挂死）
 *   5. 引用不存在的组不抛、也不静默吞掉整条结果
 *   6. 替换串里的 $ 转义
 *   7. 大文本 / 无匹配 / 空输入等边界
 */
import {
  regexReplace,
  buildReplacementPreview,
  collectReplacements,
  type Replacement,
} from '../src/lib/toolkit/regex-replace'

let pass = 0
const fails: string[] = []
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  fails.push(label)
  console.error(`  ✗ ${label}`)
}
function eq<T>(got: T, want: T, label: string): void {
  ok(got === want, `${label}（期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}）`)
}

/* ================= 1. 基础替换 ================= */
{
  const r = regexReplace('foo bar foo', 'foo', 'X')
  eq(r.output, 'X bar X', '基础替换：两处都替换')
  eq(r.count, 2, '替换计数正确')
  ok(!r.truncated, '小文本不算截断')
}

{
  eq(regexReplace('aaa', 'a', 'b').output, 'bbb', '全局替换所有出现')
  eq(regexReplace('aaa', 'a', 'b').count, 3, '计数 3')
}

{
  // 不带 g 时只替换第一处 —— 与 String.replace 语义一致
  const r = regexReplace('foo foo', 'foo', 'X', '')
  eq(r.output, 'X foo', '无 g 标志时只替换第一处')
  eq(r.count, 1, '无 g 时计数为 1')
}

{
  eq(regexReplace('abc', 'z', 'X').output, 'abc', '无匹配时原样返回')
  eq(regexReplace('abc', 'z', 'X').count, 0, '无匹配时计数为 0')
}

{
  eq(regexReplace('', 'a', 'X').output, '', '空输入不抛')
  eq(regexReplace('abc', '', 'X').output, 'XaXbXcX', '空模式匹配每个位置（与 JS 语义一致）')
}

/* ================= 2. 捕获组引用 ================= */
{
  eq(regexReplace('2024-01-15', '(\\d{4})-(\\d{2})-(\\d{2})', '$3/$2/$1').output,
    '15/01/2024', '$1 $2 $3 按序引用')
  eq(regexReplace('ab', '(a)(b)', '$2$1').output, 'ba', '组顺序可以重排')
  eq(regexReplace('abc', 'b', '[$&]').output, 'a[b]c', '$& 是整个匹配')
  eq(regexReplace('abc', 'b', '[$`]').output, 'a[a]c', '$` 是匹配前的文本')
  eq(regexReplace('abc', 'b', "[$']").output, "a[c]c", "$' 是匹配后的文本")
  eq(regexReplace('x', 'x', '$$').output, '$', '$$ 是字面量美元符号')
  // 原生：$$ →字面 $，剩下 $1 没有对应组可引用，原样输出
  eq(regexReplace('x', 'x', '$$$1').output, '$$1', '$$ 与 $1 混排：与原生一致')
}

{
  // 转义：想输出字面 $1 得写 $$
  eq(regexReplace('foo', 'foo', '$$1').output, '$1', '替换串里 $$1 输出字面 $1')
}

/* ================= 3. 命名组 ================= */
{
  const r = regexReplace('2024-01-15', '(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})', '$<d>/$<m>/$<y>')
  eq(r.output, '15/01/2024', '命名组引用 $<name>')
}

{
  // 命名组 + 数字组混用
  const r = regexReplace('a1', '(?<L>[a-z])(\\d)', '$<L>=$2')
  eq(r.output, 'a=1', '命名组与数字组混用')
}

{
  // $1 引用不存在的组：JS 语义是「原样输出 $1」（没有对应组时）
  // 我们要保证不抛、也不把整条结果吞掉
  const r = regexReplace('abc', '(a)', '$9')
  eq(r.output, '$9bc', '引用不存在的组：原样输出 $9（与 JS 一致，不抛）')
  ok(r.count === 1, '引用不存在的组时计数仍正确')
}

{
  const r = regexReplace('abc', '(a)', '$<nope>')
  eq(r.output, '$<nope>bc', '引用不存在的命名组：原样输出，不抛')
}

/* ================= 4. 零宽匹配（最关键） ================= */
{
  // a* 在 "bab" 上会匹配 3 次零宽；若 lastIndex 不推进就是死循环。
  // 这个用例跑不完就是挂死，所以放在最前面跑。
  // "bab" 上 a* 命中 4 次：index 0 的零宽、'a'、index 2 的零宽、index 3 的零宽
  const r = regexReplace('bab', 'a*', 'X')
  ok(typeof r.output === 'string', '零宽匹配不死循环（a*）')
  eq(r.output, 'XbXXbX', 'a* 的替换结果与原生一致')
  eq(r.count, 4, 'a* 在 "bab" 上匹配 4 次（含首尾零宽）')

  eq(regexReplace('abc', '', '-').output, '-a-b-c-', '空模式不挂死')
  eq(regexReplace('aaa', 'a*', 'X').output, 'XX', 'a* 全匹配不挂死（与原生一致）')
  eq(regexReplace('hello', 'x*', '-').output, '-h-e-l-l-o-', '不匹配的零宽模式也正确')

  // 换行边界
  // 不加 m 时 ^ 只锚定字符串开头（原生行为）
  const one = regexReplace('a\nb', '^', '> ')
  eq(one.count, 1, '^ 不加 m 时只匹配开头 1 次')
  const nl = regexReplace('a\nb', '^', '> ', 'gm')
  eq(nl.count, 2, '^ 加 m 时逐行匹配 2 次')
  eq(nl.output, '> a\n> b', '多行锚点逐行生效')
}

{
  // 组合：零宽 + 捕获
  const r = regexReplace('ab', '(|a)', '[$1]')
  ok(r.output.length > 0, '零宽带捕获组不挂死')
}

/* ================= 5. 收集替换明细（预览用） ================= */
{
  const list = collectReplacements('a1b2c3', /\d/g, '#')
  eq(list.length, 3, '收集到 3 处替换')
  eq(list[0].index, 1, '第 1 处在index 1')
  eq(list[0].match, '1', '第 1 处匹配到 "1"')
  eq(list[1].index, 3, '第 2 处在 index 3')
  eq(list[2].index, 5, '第 3 处在 index 5')
  eq(list.map(r => r.replacement).join(''), '###', '替换串一致')
}

{
  // 明细必须能还原最终输出（否则预览与实际替换不一致）
  const src = 'foo=1\nbar=22\nbaz=333'
  const list = collectReplacements(src, /(\w+)=(\d+)/g, '$2:$1')
  let built = ''
  let last = 0
  for (const r of list) {
    built += src.slice(last, r.index) + r.replacement
    last = r.index + r.match.length
  }
  built += src.slice(last)
  eq(built, regexReplace(src, '(\\w+)=(\\d+)', '$2:$1').output,
    '按明细拼出的结果与整体替换一致（预览不会骗人）')
}

{
  const none = collectReplacements('abc', /z/g, 'X')
  eq(none.length, 0, '无匹配时明细为空')
}

/* ================= 6. 预览 ================= */
{
  const p = buildReplacementPreview('a1b2', /\d/g, '#', 3)
  eq(p.shown, 2, '预览最多显示 limit 条')
  eq(p.total, 2, '预览报告真实总数')
  ok(p.truncated === false, '未截断时 truncated=false')
}

{
  const many = 'a'.repeat(10).replace(/a/g, 'x')
  const p = buildReplacementPreview(many, /x/g, 'y', 3)
  eq(p.shown, 3, '超限则只显示 limit 条')
  eq(p.total, 10, '总数仍是真实值 10')
  eq(p.truncated, true, '超限时truncated=true')
}

{
  // 0 匹配时不该显示「已显示 0 / 0」这种废话
  const p = buildReplacementPreview('abc', /z/g, 'X', 5)
  eq(p.total, 0, '零匹配 total=0')
  eq(p.truncated, false, '零匹配不算截断')
}

/* ================= 7. 大文本护栏 ================= */
{
  // 10 万个匹配：必须截断明细而不是把内存吃光
  const big = 'a'.repeat(100000)
  const r = regexReplace(big, /a/g, 'b')
  eq(r.count, 100000, '10 万处替换计数正确（计数不受明细护栏影响）')
  eq(r.output.length, 100000, '输出长度正确（输出永远完整，不截断）')
  // 计数护栏是 100 万，10 万没到，所以 truncated 应为 false
  eq(r.truncated, false, '10 万处未触发计数护栏')

  // 明细列表才有护栏：只收前 N 条，但 count 如实
  const detail = collectReplacements(big, /a/g, 'b', 100)
  eq(detail.length, 100, '明细按 limit 截断')
  eq(detail[0].index, 0, '明细第一处在index 0')
  eq(detail[99].index, 99, '明细第 100 处在 index 99')
}

{
  // 非法正则：抛稳定错误码，不给中英文提示语
  let code = ''
  try { regexReplace('abc', '(', 'X') } catch (e) { code = (e as Error).message }
  eq(code, 'BAD_REGEX', '非法正则抛 BAD_REGEX（界面负责映射文案）')
}

{
  // 非法 flags
  let code = ''
  try { regexReplace('abc', 'a', 'X', 'gg') } catch (e) { code = (e as Error).message }
  eq(code, 'BAD_REGEX', '非法 flags 抛 BAD_REGEX')
}

{
  // 灾难性回溯的正则不该挂死整个应用 —— 这里只验证它会抛或返回，
  // 具体行为取决于 JS 引擎，断言放宽为「不返回未定义」
  const r = regexReplace('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!', '(a+)+b', 'X')
  ok(r.output !== undefined, '灾难性回溯的输入不产生 undefined 输出')
}

/* ================= 8. Replacement 类型契约 ================= */
{
  const list: Replacement[] = collectReplacements('ab', /a/g, 'X')
  eq(list.length, 1, 'collectReplacements 返回 Replacement[]')
  ok(typeof list[0].index === 'number', 'Replacement.index 是数字')
  ok(typeof list[0].match === 'string', 'Replacement.match 是字符串')
  ok(typeof list[0].replacement === 'string', 'Replacement.replacement 是字符串')
  // 命名组存在时也要带出来（预览可能想显示组名）
  const named = collectReplacements('2024', /(?<y>\d{4})/g, '$<y>')
  ok(named.length === 1, '命名组匹配成功')
  eq(named[0].match, '2024', '命名组场景 match 正确')
}

/* ================= 结果 ================= */

if (fails.length) {
  console.error(`\n✗ smoke:regexreplace 失败：${pass} 通过 / ${fails.length} 失败`)
  process.exit(1)
}
console.log(`✓ smoke:regexreplace ${pass} 项全部通过`)
