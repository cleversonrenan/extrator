# CCI Extrator (TRJ / TMG / TNE)

Repositório: https://github.com/cleversonrenan/extrator

Este pacote contém os três extratores HTML atualizados e os arquivos JSON de mapeamento regional externo.

## Arquivos para enviar ao repositório

- `CCI_EXTRATOR_TRJ_v1.html`
- `CCI_EXTRATOR_TMG_V1.html`
- `CCI_EXTRATOR_TNE_V1.html`
- `CCI_EXTRATOR_TRJ_v1.regioes.json` (mapeamento regional TRJ)
- `CCI_EXTRATOR_TMG_V1.regioes.json` (mapeamento regional TMG)
- `CCI_EXTRATOR_TNE_v1.regioes.json` (mapeamento regional TNE)
- `README.md`

> Não publiquei nada diretamente no GitHub. Faça o upload/revisão manualmente.

## Alterações implementadas

### 1) Identificação de Missão Crítica
- Nos displays **Chamados em Movimento** e **Concentradores**, chamados classificados como Missão Crítica (conforme dados importados) passam a exibir **⚠️ Crítico** (ícone em amarelo/laranja e texto "Crítico"), visível sem abrir detalhes.
- A classificação utiliza os campos/flags reais já calculados pelo extrator (`Missão Crítica`/regras existentes da planilha de concentradores). Nenhum critério fictício foi inventado.
- Chamados não críticos não exibem o indicador.
- A implementação foi adaptada individualmente em TRJ, TMG e TNE, preservando a estrutura original de cada arquivo.

### 2) Exportação de Concentradores e Missão Crítica
Na área de exportações foram adicionados:
- **Copiar Conc/MC**: copia para a área de transferência um relatório formatado para WhatsApp.
- **XLSX Conc/MC**: exporta planilha Excel com chamados de Concentradores e/ou Missão Crítica.

Características:
- Respeita os filtros ativos.
- Evita duplicidade quando o chamado é simultaneamente Concentrador e Missão Crítica (união sem repetição).
- XLSX inclui campos disponíveis: Região, Tipo (Fixa/Móvel), TSK, Prioridade, Site / NE ID / END_ID, Tipo de falha, Cruzamento / Concentrador, Missão Crítica, SLA, Tempo restante e Situação do SLA.
- Cálculo de tempo restante/situação baseado na data/hora real no momento da exportação.

### 3) Formato do relatório WhatsApp (Conc/MC)
- Título: `*Concentradores e Missão Crítica na fila no momento.*`
- Agrupamento por **Região** e **Tipo (Fixa/Móvel)**.
- Uma linha por chamado.
- Inclui `⚠️ Crítico` somente quando houver Missão Crítica.
- Exibe `⏰ Vencido` quando o SLA estiver expirado.
- Preserva a data do SLA no formato brasileiro.
- Não inclui dados fictícios.
- Botão de cópia usa `navigator.clipboard.writeText` quando disponível e possui fallback (`execCommand`/prompt manual) e feedback visual de sucesso/erro.

> Observação: nomes de região/tipo e campos exibidos seguem os dados e mapeamentos de cada extrator (TRJ/TMG/TNE) e os filtros ativos.

### 4) Mapeamentos regionais dinâmicos (JSON no repositório)
- Cada extrator carrega um JSON externo próprio:
  - TRJ: `CCI_EXTRATOR_TRJ_v1.regioes.json` (`regioes`, `places`)
  - TMG: `CCI_EXTRATOR_TMG_V1.regioes.json` (`anfLabels` e estrutura regional do TMG)
  - TNE: `CCI_EXTRATOR_TNE_v1.regioes.json` (estrutura regional do TNE)
- Botão **🔄 Atualizar regiões** tenta recarregar o JSON com estratégia anti-cache (`?_ts=...` e `cache: no-store`).
- Ao atualizar a página (em ambiente com acesso HTTP/HTTPS, ex.: GitHub Pages), o extrator tenta carregar o JSON externo.
- **Fallback seguro:** se a conexão/leitura falhar, a configuração local embutida/original é preservada.
- Os mapeamentos originais foram mantidos como base inicial.
- Não misture classificações/mapeamentos entre TRJ, TMG e TNE.

## Precauções importantes

1. **Backup antes de substituir:** mantenha cópia dos HTML/JSON atuais do repositório antes do upload.
2. **Teste com dados reais:** valide importação CSV/XLSX, cruzamentos, Missão Crítica, concentradores, filtros, gráficos e exportações com planilhas reais de operação.
3. **Clipboard/permissões:** a cópia pode depender de contexto seguro (HTTPS/GitHub Pages) e permissões do navegador. Em caso de bloqueio, o sistema tenta fallback e informa erro.
4. **Abertura local (`file://`)**: navegadores podem bloquear `fetch` de arquivos/recursos remotos por CORS/origem nula. Nesse caso, a atualização remota pode não funcionar; o extrator mantém a configuração local e informa o motivo. Para atualização remota confiável, use GitHub Pages ou servidor HTTP local.
5. **GitHub Pages/cache:** após publicar alterações nos JSON, use **Atualizar regiões** ou atualize a página. Em alguns casos pode haver cache de CDN/navegador.
6. **Não alterar nomes dos arquivos** esperados pelos links/configurações (`CCI_EXTRATOR_TRJ_v1.html`, `CCI_EXTRATOR_TMG_V1.html`, `CCI_EXTRATOR_TNE_V1.html` e respectivos `.regioes.json`).
7. **Validação por regional:** como TRJ, TMG e TNE possuem estruturas/mapeamentos próprios, confira individualmente displays, filtros e exportações após qualquer ajuste nos JSONs.
8. **Integridade funcional:** bibliotecas incorporadas e funcionalidades pré-existentes foram preservadas na medida do possível; ainda assim, revise em homologação antes de uso operacional.

## Testes realizados / limitações

- **Realizados neste ambiente:** verificações automatizadas de sintaxe/estrutura JavaScript por inspeção programática (`node --check` em blocos de script extraídos quando aplicável), conferência de presença das funções/elementos adicionados (indicador ⚠️ Crítico, botões de exportação Conc/MC, handlers de cópia/XLSX, botão/config de atualização regional) e validação de integridade básica dos JSON gerados.
- **Não executados aqui:** testes interativos completos no navegador com upload real de CSV/XLSX, conferência visual de temas claro/escuro, comportamento de clipboard em diferentes navegadores, atualização remota via GitHub Pages em produção e validação ponta a ponta com as bases operacionais reais de TRJ/TMG/TNE.
- **Recomendação:** homologar os três arquivos em ambiente de navegador (preferencialmente via GitHub Pages) com amostras reais antes de substituir em produção.

## Resumo rápido
- Adicionado **⚠️ Crítico** (Missão Crítica) visível em Chamados em Movimento e Concentradores.
- Adicionadas exportações dedicadas de **Concentradores e Missão Crítica** (copiar WhatsApp + XLSX), respeitando filtros e sem duplicidade.
- Adicionada atualização de **mapeamentos regionais via JSON** por extrator, com botão de atualização, anti-cache e fallback local.
- Funcionalidades e layout originais preservados conforme solicitado; recomenda-se validação final com dados reais.
