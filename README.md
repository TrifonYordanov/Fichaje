# Mi Bolsa de Horas

PWA estática para llevar una bolsa personal de horas a partir de exports Excel de TimeMoto.

## Publicación más sencilla: GitHub Pages

1. Crea un repositorio, por ejemplo `mi-bolsa-horas`.
2. Sube **los archivos del interior de esta carpeta** a la raíz del repositorio.
3. Ve a `Settings` → `Pages`.
4. En `Build and deployment`, selecciona `Deploy from a branch`.
5. Rama `main`, carpeta `/(root)` y guarda.
6. Abre la URL publicada.

No requiere npm, build, servidor ni base de datos.

## Uso

- Pantalla principal: calendario mensual con saldo diario.
- Pulsa un día para ver o editar su detalle, nota y motivo de horas extra.
- `Importar TimeMoto`: abre el asistente, entra en TimeMoto, exporta el informe a Excel y selecciona el archivo descargado.
- Reimportar una fecha actualiza sus datos TimeMoto y conserva las notas/motivos que ya hubieras escrito.
- Ajustes iniciales incluidos: lunes-jueves 8:00, viernes 7:00. La app ya contiene el 17/09 (+0:37) y el 18/09 (+0:17), por lo que arranca con una bolsa total de +0:54.

## Privacidad

Los Excel se leen en el navegador. Los datos quedan en `localStorage` del dispositivo. Usa `Ajustes → Exportar copia JSON` para conservar una copia o mover los datos a otro dispositivo.

## Limitación de TimeMoto

Una web/PWA no puede leer automáticamente las descargas realizadas por otra web. El asistente reduce el flujo a: abrir TimeMoto → exportar Excel → volver → elegir el archivo. En navegadores que implementan File Handling para PWA, abrir un `.xlsx` con Mi Bolsa puede lanzar la importación directamente.
