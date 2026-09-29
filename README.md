# Harpur Land Mapper — Version 5.6.1

## Sheet 02 fix

V5.6.1 uses the exact BhuNaksha values captured from the official viewer for Harpur CS Sheet 02.

Sheet 02 native extent:

```text
EPSG:32645
xmin 190449.736065251
ymin 2805551.8911005286
xmax 192577.99499258207
ymax 2806753.2243631342
```

Sheet 02 exact working WMS display BBOX:

```text
189720.5811856323,2804925.385129284,193307.14987220077,2807379.730334379
```

GIS code:

```text
CS30010202301990602
```

The earlier 5.6 error came from assuming `getVVVVExtentGeoref` returned a nested `nativeExtent` object. For Sheet 02 the captured response is flat (`xmin`, `ymin`, `xmax`, `ymax`). V5.6.1 no longer derives Sheet 02's display BBOX; it uses the exact official viewer request.

Also pins Node to 22.22.0 for Render compatibility with `better-sqlite3`.
