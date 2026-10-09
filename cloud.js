// Empacotado somente para a publicação com Supabase. O widget continua independente.
import { createClient } from '@supabase/supabase-js';
const client = createClient(CENTRAL_CONFIG.url,CENTRAL_CONFIG.key,{auth:{storageKey:'central-admin-session'}});
window.CentralCloud = {
  async api(url,options = {}) {
    const { data,error } = await client.auth.getSession();
    if (error || !data.session) throw new Error('Entre no painel para acessar as ocorrências.');
    const response = await fetch(url,{...options,headers:{...options.headers,Authorization:`Bearer ${data.session.access_token}`},signal:AbortSignal.timeout(30000)});
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Erro ${response.status}.`);
    return payload;
  },
  async start(onAccess,onLogout) {
    const form = document.querySelector('#login-form'), screen = document.querySelector('#login-screen');
    const app = document.querySelector('#workspace'), alert = document.querySelector('#login-error');
    const button = form.querySelector('button'), logout = document.querySelector('#logout');
    let generation = 0;
    async function enter(session) {
      const current = ++generation;
      app.hidden = true; screen.hidden = false; alert.textContent = ''; button.disabled = true;
      onLogout();
      try {
        if (!session) return;
        await window.CentralCloud.api('/api/reports?access=check');
        if (current !== generation) return;
        screen.hidden = true; app.hidden = false; logout.hidden = false;
        document.querySelector('#admin-email').textContent = session.user.email;
        onAccess();
      } catch (error) { if (current === generation) alert.textContent = error.message; }
      finally { if (current === generation) button.disabled = false; }
    }
    form.onsubmit = async event => {
      event.preventDefault(); button.disabled = true; alert.textContent = 'Entrando…';
      try {
        const { data,error } = await client.auth.signInWithPassword({email:form.elements.email.value.trim(),password:form.elements.password.value});
        if (error) throw new Error('Não foi possível entrar. Confira seu e-mail e senha.');
        form.elements.password.value = ''; await enter(data.session);
      } catch (error) { alert.textContent = error.message; button.disabled = false; }
    };
    logout.onclick = async () => {
      // Limpar dados da tela imediatamente, mesmo se a rede falhar.
      generation++; onLogout(); app.hidden = true; screen.hidden = false; logout.hidden = true;
      await client.auth.signOut({scope:'local'}); alert.textContent = ''; button.disabled = false;
    };
    client.auth.onAuthStateChange((event,session) => {
      if (event === 'SIGNED_OUT') { generation++; onLogout(); app.hidden = true; screen.hidden = false; logout.hidden = true; button.disabled = false; }
      // SIGNED_IN é tratado no submit; TOKEN_REFRESHED mantém os dados da tela.
    });
    const { data } = await client.auth.getSession(); await enter(data.session);
  }
};
