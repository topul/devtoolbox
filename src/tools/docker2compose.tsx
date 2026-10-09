/**
 * docker run → docker-compose 转换 —— 别人 README 里的启动命令，粘过来直接换成
 * 能进仓库的 compose 服务段。解析与 YAML 生成都在 toolkit/docker2compose.ts
 * （宽松 flag 解析 + 手写 YAML）；本文件只做展示：一条命令对应一个 service，
 * 多条命令→多个服务的场景少见，为它加多行编辑器 + 多组服务名输入不值当。
 * 服务名留空时默认取 image 去掉 registry/tag 后的名字。
 */
import React, { useMemo } from 'react'
import {
  Btn,
  ErrorNote,
  Input,
  ResultPanel,
  TA,
  ToolShell,
  usePersistedState,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { parseDockerRun, toComposeYaml } from '../lib/toolkit/docker2compose'

const L = {
  zh: {
    cmd: 'docker run 命令',
    cmdPh: 'docker run -d -p 8080:80 --name web nginx:1.25-alpine',
    example: '示例',
    serviceName: '服务名',
    serviceNamePh: '留空则用镜像名',
    output: 'docker-compose.yml',
    empty: '粘贴 docker run 命令后，这里生成对应的 compose YAML',
  },
  en: {
    cmd: 'docker run command',
    cmdPh: 'docker run -d -p 8080:80 --name web nginx:1.25-alpine',
    example: 'Example',
    serviceName: 'Service name',
    serviceNamePh: 'Defaults to the image name',
    output: 'docker-compose.yml',
    empty: 'Paste a docker run command and the compose YAML shows up here',
  },
}

/** 典型命令：端口 + 挂载 + 环境变量 + 重启策略 + 容器名，覆盖最常见面 */
const EXAMPLE_CMD =
  'docker run -d --name web -p 8080:80 -v ./site:/usr/share/nginx/html:ro ' +
  '-e NGINX_HOST=example.com -e NGINX_PORT=80 --restart unless-stopped nginx:1.25-alpine'

/** 镜像名 → 默认服务名：去 registry 前缀、digest 与 tag */
function fallbackServiceName(image: string): string {
  const last = image.slice(image.lastIndexOf('/') + 1)
  return last.split('@')[0].split(':')[0] || 'app'
}

export function Docker2ComposeTool() {
  const l = useLocalized(L)
  const [cmd, setCmd] = usePersistedState('docker2compose', 'cmd', '')
  const [name, setName] = usePersistedState('docker2compose', 'serviceName', '')

  const parsed = useMemo(() => (cmd.trim() ? parseDockerRun(cmd) : null), [cmd])
  const error = parsed && 'error' in parsed ? parsed.error : null
  const ok = parsed && 'service' in parsed ? parsed : null

  const svcName = name.trim() || (ok ? fallbackServiceName(ok.image) : '')
  const yaml = useMemo(
    () =>
      ok && svcName
        ? toComposeYaml([{ name: svcName, image: ok.image, service: ok.service }])
        : null,
    [ok, svcName],
  )

  return (
    <ToolShell toolId="docker2compose">
      <TA
        toolInput
        spellCheck
        value={cmd}
        onChange={setCmd}
        label={l.cmd}
        placeholder={l.cmdPh}
        rows={6}
        labelRight={
          <Btn variant="ghost" onClick={() => setCmd(EXAMPLE_CMD)}>
            {l.example}
          </Btn>
        }
      />
      <Input value={name} onChange={setName} label={l.serviceName} placeholder={l.serviceNamePh} />

      {error && <ErrorNote msg={error} />}

      <ResultPanel title={l.output} text={yaml ?? undefined} emptyHint={l.empty} maxHeight={420} />
    </ToolShell>
  )
}
