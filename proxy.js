const http = require('http');
const net = require('net');
const { URL } = require('url');
const querystring = require('querystring');

// --- НАСТРОЙКИ ---
const PROXY_PORT = 2345; // Порт для прокси-сервера
const UI_PORT = 2346;    // Порт для веб-интерфейса управления

// Черный список теперь изменяемый. Начнем с нескольких примеров.
let BLACKLIST = [
  'vk.com',
  'tiktok.com',
  'facebook.com'
];
// --- КОНЕЦ НАСТРОЕК ---


// --- ЛОГИКА ПРОКСИ-СЕРВЕРА (Порт 8080) ---

// Функция проверки блокировки
function isBlocked(hostname) {
  if (!hostname) return false;
  const lowerCaseHostname = hostname.toLowerCase();
  return BLACKLIST.some(blockedDomain => 
    lowerCaseHostname === blockedDomain || lowerCaseHostname.endsWith('.' + blockedDomain)
  );
}

const proxyServer = http.createServer((clientReq, clientRes) => {
  const hostname = clientReq.headers.host || new URL(clientReq.url).hostname;

  if (isBlocked(hostname)) {
    console.log(`[PROXY] ЗАБЛОКИРОВАНО: HTTP доступ к ${hostname}`);
    clientRes.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    clientRes.end('<h1>403 Доступ запрещен</h1><p>Этот ресурс заблокирован вашим прокси-сервером.</p>');
    return;
  }
  
  const options = {
    host: clientReq.headers.host,
    port: 80,
    path: clientReq.url,
    method: clientReq.method,
    headers: clientReq.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes, { end: true });
  });

  clientReq.pipe(proxyReq, { end: true });
  proxyReq.on('error', (err) => { clientRes.writeHead(502).end(); });
});

proxyServer.on('connect', (req, clientSocket, head) => {
  const [hostname, port] = req.url.split(':');

  if (isBlocked(hostname)) {
    console.log(`[PROXY] ЗАБЛОКИРОВАНО: HTTPS соединение с ${hostname}`);
    clientSocket.destroy();
    return;
  }

  const serverSocket = net.connect(port || 443, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.write(head);
    serverSocket.pipe(clientSocket, { end: true });
    clientSocket.pipe(serverSocket, { end: true });
  });

  clientSocket.on('error', (err) => {});
  serverSocket.on('error', (err) => {});
});


// --- ЛОГИКА ВЕБ-ИНТЕРФЕЙСА (Порт 8081) ---

// Функция, которая генерирует HTML-страницу панели управления
function getUIPage() {
  let listItems = BLACKLIST.map(domain => 
    `<li>
       <span>${domain}</span>
       <form action="/remove" method="POST" style="display: inline;">
         <input type="hidden" name="domain" value="${domain}">
         <button type="submit" class="remove-btn">Удалить</button>
       </form>
     </li>`
  ).join('');

  if (BLACKLIST.length === 0) {
    listItems = "<p>Список блокировки пуст.</p>";
  }

  return `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Панель управления прокси</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; background-color: #f0f2f5; color: #1c1e21; }
        .container { max-width: 600px; margin: 20px auto; padding: 20px; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1, h2 { text-align: center; color: #333; }
        ul { list-style: none; padding: 0; }
        li { display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-bottom: 1px solid #ddd; font-size: 1.1em; }
        li:last-child { border-bottom: none; }
        .add-form { display: flex; margin-top: 20px; }
        .add-form input[type="text"] { flex-grow: 1; padding: 10px; border: 1px solid #ccc; border-radius: 6px 0 0 6px; font-size: 1em; }
        .add-form button { padding: 10px 15px; border: none; background-color: #1877f2; color: white; font-size: 1em; cursor: pointer; border-radius: 0 6px 6px 0; }
        .remove-btn { background-color: #e74c3c; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; }
        .status { text-align: center; margin-top: 20px; font-size: 0.9em; color: #606770; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Панель управления прокси</h1>
        
        <h2>Добавить домен в черный список</h2>
        <form action="/add" method="POST" class="add-form">
          <input type="text" name="domain" placeholder="например, example.com" required>
          <button type="submit">Добавить</button>
        </form>
        
        <h2>Заблокированные домены (${BLACKLIST.length})</h2>
        <ul>${listItems}</ul>

        <div class="status">
          Прокси работает на порту: ${PROXY_PORT}<br>
          Панель управления на порту: ${UI_PORT}
        </div>
      </div>
    </body>
    </html>
  `;
}

const uiServer = http.createServer((req, res) => {
  // Обработка добавления домена
  if (req.url === '/add' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      const parsedBody = querystring.parse(body);
      const domainToAdd = parsedBody.domain.trim().toLowerCase();
      if (domainToAdd && !BLACKLIST.includes(domainToAdd)) {
        BLACKLIST.push(domainToAdd);
        console.log(`[UI] Добавлен домен: ${domainToAdd}`);
      }
      // Перенаправляем обратно на главную страницу
      res.writeHead(302, { 'Location': '/' });
      res.end();
    });
  } 
  // Обработка удаления домена
  else if (req.url === '/remove' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      const parsedBody = querystring.parse(body);
      const domainToRemove = parsedBody.domain;
      BLACKLIST = BLACKLIST.filter(d => d !== domainToRemove);
      console.log(`[UI] Удален домен: ${domainToRemove}`);
      // Перенаправляем обратно на главную страницу
      res.writeHead(302, { 'Location': '/' });
      res.end();
    });
  } 
  // Показываем главную страницу
  else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getUIPage());
  }
});


// --- ЗАПУСК ОБОИХ СЕРВЕРОВ ---
proxyServer.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`Блокирующий прокси-сервер запущен на порту ${PROXY_PORT}`);
});

uiServer.listen(UI_PORT, '0.0.0.0', () => {
  console.log(`Панель управления доступна по адресу http://localhost:${UI_PORT} или http://<ВАШ_IP>:${UI_PORT}`);
  console.log('Нажмите Ctrl+C для остановки.');
});
