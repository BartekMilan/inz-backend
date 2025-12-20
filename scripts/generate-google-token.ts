#!/usr/bin/env ts-node

/**
 * Skrypt pomocniczy do generowania REFRESH_TOKEN dla Google OAuth2
 * 
 * Użycie:
 *   npm run generate-google-token
 *   lub
 *   ts-node scripts/generate-google-token.ts
 * 
 * Wymagane zmienne środowiskowe (lub argumenty):
 *   GOOGLE_AUTH_CLIENT_ID - Client ID z Google Cloud Console
 *   GOOGLE_AUTH_CLIENT_SECRET - Client Secret z Google Cloud Console
 * 
 * Alternatywnie można podać jako argumenty:
 *   ts-node scripts/generate-google-token.ts --client-id=XXX --client-secret=YYY
 */

import * as readline from 'readline';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Wczytaj .env z katalogu głównego projektu
// W ts-node __dirname jest dostępny automatycznie
try {
  // @ts-ignore - __dirname jest dostępny w ts-node
  const projectRoot = path.resolve(__dirname, '..');
  dotenv.config({ path: path.join(projectRoot, '.env') });
} catch {
  // Fallback jeśli __dirname nie jest dostępny
  dotenv.config();
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log('\n=== Generator REFRESH_TOKEN dla Google OAuth2 ===\n');

  // Pobierz CLIENT_ID i CLIENT_SECRET z argumentów lub .env
  let clientId = process.env.GOOGLE_AUTH_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_AUTH_CLIENT_SECRET;

  // Sprawdź argumenty wiersza poleceń
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg.startsWith('--client-id=')) {
      clientId = arg.split('=')[1];
    } else if (arg.startsWith('--client-secret=')) {
      clientSecret = arg.split('=')[1];
    }
  }

  // Jeśli brakuje, poproś użytkownika
  if (!clientId) {
    clientId = await question('Podaj GOOGLE_AUTH_CLIENT_ID: ');
  }

  if (!clientSecret) {
    clientSecret = await question('Podaj GOOGLE_AUTH_CLIENT_SECRET: ');
  }

  if (!clientId || !clientSecret) {
    console.error('\n❌ Błąd: CLIENT_ID i CLIENT_SECRET są wymagane!');
    process.exit(1);
  }

  // Scope'y wymagane dla EventSync
  const scopes = [
    'https://www.googleapis.com/auth/drive', // Pełny dostęp do Drive (kopiowanie, eksport, tworzenie plików)
    'https://www.googleapis.com/auth/spreadsheets', // Dostęp do Google Sheets
    'https://www.googleapis.com/auth/documents', // Edycja dokumentów Google Docs
  ];

  // Utwórz klienta OAuth2 dla Desktop App
  // Dla Desktop App w Google Cloud Console użyj redirect URI: http://localhost lub http://localhost:8080
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost', // Redirect URI dla Desktop App (bez sztywnego URI)
  );

  // Wygeneruj URL autoryzacyjny
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Wymagane do uzyskania refresh_token
    scope: scopes,
    prompt: 'consent', // Wymusza wyświetlenie ekranu zgody (ważne dla refresh_token)
  });

  console.log('\n📋 KROK 1: Otwórz poniższy URL w przeglądarce:');
  console.log('\n' + authUrl + '\n');
  console.log('📋 KROK 2: Zaloguj się kontem Google Administratora');
  console.log('📋 KROK 3: Zatwierdź uprawnienia');
  console.log('📋 KROK 4: Skopiuj kod autoryzacyjny z ekranu\n');

  const code = await question('Wklej kod autoryzacyjny tutaj: ');

  if (!code || code.trim().length === 0) {
    console.error('\n❌ Błąd: Kod autoryzacyjny jest wymagany!');
    rl.close();
    process.exit(1);
  }

  try {
    // Wymień kod na tokeny
    const { tokens } = await oauth2Client.getToken(code.trim());

    if (!tokens.refresh_token) {
      console.error('\n❌ Błąd: Nie otrzymano refresh_token!');
      console.error('   Upewnij się, że:');
      console.error('   1. Użyłeś access_type: "offline"');
      console.error('   2. Użyłeś prompt: "consent"');
      console.error('   3. To pierwsza autoryzacja dla tego konta (lub odwołałeś wcześniejsze uprawnienia)');
      rl.close();
      process.exit(1);
    }

    console.log('\n✅ Sukces! Otrzymano tokeny:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n📝 Dodaj poniższe zmienne do pliku .env:\n');
    console.log(`GOOGLE_AUTH_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_AUTH_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_AUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n💡 Uwaga:');
    console.log('   - Access token wygasa po ~1 godzinie');
    console.log('   - Refresh token jest długoterminowy i pozwala na odświeżanie access token');
    console.log('   - Refresh token jest ważny dopóki użytkownik nie odwoła uprawnień');
    console.log('   - Zachowaj refresh_token w bezpiecznym miejscu (nie commituj do repo!)\n');

    // Opcjonalnie: wyświetl informacje o access token
    if (tokens.access_token) {
      console.log('ℹ️  Access token (tymczasowy): ' + tokens.access_token.substring(0, 20) + '...');
    }
    if (tokens.expiry_date) {
      const expiryDate = new Date(tokens.expiry_date);
      console.log('ℹ️  Access token wygasa: ' + expiryDate.toLocaleString('pl-PL'));
    }
    console.log('');

  } catch (error: any) {
    console.error('\n❌ Błąd podczas wymiany kodu na tokeny:');
    console.error('   ' + error.message);
    if (error.response?.data) {
      console.error('   Szczegóły:', JSON.stringify(error.response.data, null, 2));
    }
    rl.close();
    process.exit(1);
  }

  rl.close();
}

main().catch((error) => {
  console.error('\n❌ Nieoczekiwany błąd:', error);
  rl.close();
  process.exit(1);
});

