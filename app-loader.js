(async () => {
  const target = document.getElementById('app');
  try {
    const parts = [
      'assets/app/app-01.b64','assets/app/app-02.b64',
      'assets/app/app-03a.b64','assets/app/app-03b.b64','assets/app/app-03c.b64',
      'assets/app/app-04.b64','assets/app/app-05.b64','assets/app/app-06.b64',
      'assets/app/app-07.b64','assets/app/app-08.b64'
    ];
    const encoded = (await Promise.all(parts.map(async (path) => {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error(`No se pudo cargar ${path}`);
      return (await response.text()).trim();
    }))).join('');
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    let source = new TextDecoder().decode(bytes);

    // Fuerza el enlace de confirmación hacia el dominio público de producción.
    source = source.replace(
      "options:{data:{full_name:",
      "options:{emailRedirectTo:window.location.origin+'/',data:{full_name:"
    );

    // Limpia fragmentos de error viejos para que no bloqueen una nueva sesión.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.get('error')) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    new Function(source)();
  } catch (error) {
    console.error(error);
    target.innerHTML = '<div class="fatal">No se pudo iniciar ValoraIA. Revisa el despliegue y vuelve a cargar.</div>';
  }
})();
