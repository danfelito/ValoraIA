# Bodegas por superficie de terreno

`intake_data.comparison_area_basis` admite `auto`, `built` y `land`.
El valor `land` sólo se acepta para bodegas e industriales (además de terrenos y ranchos, que ya usaban terreno). No sustituye automáticamente datos ausentes.

En una bodega con elección `land`, se seleccionan otras bodegas construidas y se divide el precio total del inmueble entre los metros cuadrados de su terreno. No se incluyen lotes baldíos, viviendas, rentas, la propia publicación ni anuncios que sólo acrediten superficie construida. Se conserva el filtro de tamaño +/-30%, ubicación y demás restricciones existentes.

La elección se conserva en el expediente, participa en la huella del informe y se explica en el PDF. Los metros construidos desconocidos permanecen desconocidos; no se utilizan los metros de terreno para rellenarlos. Cambiar la base no permite calcular un enfoque físico sin desglose de construcción, alcance, región, fecha y depreciación.

La migración `warehouse_comparison_basis` conserva la comprobación `created_by=auth.uid()` y los privilegios existentes al corregir la ficha. No modifica pagos, roles o políticas. Si el formulario de edición no envía una base, conserva la ya elegida.

La carga comercial de evidencia ocurre antes de solicitar la liga de pago. Los archivos son privados, quedan bajo la organización y solicitud comprobadas, y cada ruta incluye SHA-256 para reintentar sin sobrescribir ni duplicar el mismo contenido. Un fallo de almacenamiento detiene el checkout. Empezar otra captura no reutiliza ni modifica silenciosamente un expediente anterior.

La búsqueda recibe expresamente la base seleccionada. El precio anunciado del sujeto sólo sirve para contrastar el resultado, nunca como comparable. El enlace del sujeto se captura para excluirlo.

Se mantiene la validación del pago: la ficha debe contener la superficie de la base elegida. La generación comercial aún exige pago confirmado y no lo simula. Las vistas previas técnicas conservan su autorización y no envían correos.

Los PDF nuevos usan `commercial-report-4`; las versiones anteriores se conservan. El PDF presenta los comparables íntegros y hasta doce referencias documentales aplicadas o de suelo en la misma zona; explica los costos no aplicados, en lugar de reproducir indiscriminadamente todos los modelos del catálogo. La extracción completa permanece en el repositorio privado.
