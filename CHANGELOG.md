# Changelog

## [0.2.0] - 2026-10-08

- Por ahora solo gabinete: catálogo, creaciones, «+ Gabinete» y CSV muestran
  y generan solo esa familia (las filas de otras quedan como «Solo gabinete»).
- Sin fotos de módulo: tarjetas y página del módulo muestran el alzado
  generado con el diseño efectivo.
- Vista previa con zoom (rueda, + / −), desplazamiento (arrastrar) y
  «Ajustar» (doble clic) en un marco fijo que no se desborda.
- Página del módulo: vista al centro y el diseño en una barra a la derecha;
  «Avanzado…» abre una ventana emergente con todas las variables y su propia
  vista previa. Cambiar el diseño en la barra rearma «Avanzado» desde él.

## [0.1.0] - 2026-10-08

Primera versión.

- Ventana única con secciones: Proyecto, Catálogo, Creaciones, Crear desde
  CSV y Ajustes, con la estética de KitchenCatalog.
- Configuración global del proyecto (frente, manija, material con foto,
  tarja, medidas comunes) guardada en el `.skp`; personalización por módulo.
- Vista previa SVG «Así se verá» con estilo de frente, manija y material.
- «Avanzado»: todas las variables del manifiesto de Royal Catalog Creator con
  sus reglas (vía `RCC_CORE`); generar en escena y/o en Creaciones.
- CSV/Excel: importar, revisar, editar fila y generar en lote a Creaciones.
- Requiere Catálogo de Módulos 0.3.0+ y Royal Catalog Creator 1.2.0+.
