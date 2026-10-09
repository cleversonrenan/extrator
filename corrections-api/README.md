# Banco de correções do CCI Extrator

Este serviço guarda as correções de região e subárea feitas pelo botão de lápis do extrator TRJ. Os usuários não precisam de conta, login ou senha. O banco é atualizado somente pelas telas do extrator e mantém um histórico interno de inclusão, alteração e restauração.

## Publicação única

É necessário ter uma conta gratuita na Cloudflare. Na pasta `corrections-api`:

1. Execute `npm install`.
2. Execute `npx wrangler login` e autorize a conta no navegador.
3. Execute `npx wrangler d1 create cci-correcoes`.
4. Copie o `database_id` exibido para `wrangler.jsonc`.
5. Execute `npx wrangler d1 execute cci-correcoes --remote --file=schema.sql`.
6. Execute `npx wrangler deploy`.
7. Copie o endereço final do Worker para `../corrections-config.json`, no campo `apiUrl`.

Depois dessa configuração, as correções passam a ser compartilhadas automaticamente entre todos os usuários do extrator. O arquivo `corrections-config.json` pode ficar público: ele contém somente o endereço da API, sem senha ou chave de banco.

## Proteções incluídas

- gravação aceita somente a partir de `https://cleversonrenan.github.io`;
- limite padrão de 30 alterações por endereço de rede a cada 10 minutos;
- validação de END_ID, região, subárea, motivo e tamanho da requisição;
- histórico de todas as alterações e restaurações;
- nenhuma credencial fica no GitHub ou no navegador.

O navegador continuará usando uma cópia local se a internet ou o serviço estiver indisponível. Assim que o banco responder novamente, a lista central volta a prevalecer.
