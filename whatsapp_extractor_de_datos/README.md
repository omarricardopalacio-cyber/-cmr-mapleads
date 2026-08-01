# Campaign Extractor para WhatsApp Web

Extension para `web.whatsapp.com` que recorre chats, entra uno a uno y extrae:

- nombre/contacto
- numero detectado (si aparece en encabezado)
- mensajes visibles del chat

Incluye interfaz oscura tipo panel, boton de iniciar/detener y exportacion en **JSON** y **CSV**.

## 1) Instalar extension en Chrome

1. Abre `chrome://extensions/`
2. Activa **Modo desarrollador**
3. Clic en **Cargar descomprimida**
4. Selecciona la carpeta:
   - `whatsapp_extractor_extension`

## 2) Ejecutar extraccion

1. Abre `https://web.whatsapp.com/` y espera que carguen tus chats.
2. Clic en el icono de la extension.
3. Configura:
   - **Origen**:
     - `Toda la bandeja de entrada`
     - `Solo no leidos (visual)`
   - **Max. chats**
   - **Pausa (ms)** (si WhatsApp va lento, sube este valor)
   - **Formato exportar** (`JSON`, `CSV`, `JSON + CSV`)
4. Clic en **Iniciar extraccion**.
5. La extension entra chat por chat en modo de navegacion "humana" (pausas con variacion, click y scroll progresivo).
6. En cada chat hace barrido de mensajes y guarda:
   - mensajes estructurados (`messages`) cuando se detectan correctamente
   - copia de texto del chat (`rawTranscript`) como respaldo
7. Puedes detener en cualquier momento con **Detener**.
8. Al finalizar, puedes descargar desde botones o por descarga automatica segun el formato elegido.

## 3) Pasar JSON a Excel con metricas (opcional)

En la carpeta raiz del proyecto existe `analizar_desde_json.py`.

Uso:

```bash
python analizar_desde_json.py --entrada "ruta/al/archivo.json" --salida resultados.xlsx
```

## Notas importantes

- WhatsApp Web cambia su HTML con frecuencia; si un selector deja de funcionar, se debe ajustar `content.js`.
- La extension intenta hacer precarga de historial y barrido por scroll para copiar mas contenido.
- Aun asi, para historicos muy largos conviene extraer por bloques (ejemplo: 30-50 chats por corrida).
- Usa esta herramienta cumpliendo terminos de uso, privacidad y normativa aplicable a tus datos.
