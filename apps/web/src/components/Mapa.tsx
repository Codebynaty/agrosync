import L from 'leaflet';
import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';

type P = { lat: number; lng: number };

const numero = (n: number | string, cor: string) =>
  L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${cor};color:#fff;display:grid;place-items:center;font-weight:800;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${n}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

function Enquadrar({ pontos }: { pontos: P[] }) {
  const map = useMap();
  useEffect(() => {
    if (pontos.length) map.fitBounds(L.latLngBounds(pontos.map((p) => [p.lat, p.lng])), { padding: [30, 30] });
  }, [map, JSON.stringify(pontos)]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const Fundo = () => (
  <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
);

export function MapaRota({
  destino,
  paradas,
  alto,
}: {
  destino: P & { nome: string };
  paradas: (P & { rotulo: string; feito?: boolean })[];
  alto?: boolean;
}) {
  const caminho: [number, number][] = [destino, ...paradas, destino].map((p) => [p.lat, p.lng]);
  return (
    <div className={`mapa ${alto ? 'alto' : ''}`}>
      <MapContainer center={[destino.lat, destino.lng]} zoom={10} style={{ height: '100%' }} scrollWheelZoom={false}>
        <Fundo />
        <Polyline positions={caminho} pathOptions={{ color: '#2f7d32', weight: 3, dashArray: '6 6' }} />
        <Marker position={[destino.lat, destino.lng]} icon={numero('🏁', '#1d5a21')}>
          <Tooltip>{destino.nome}</Tooltip>
        </Marker>
        {paradas.map((p, i) => (
          <Marker key={i} position={[p.lat, p.lng]} icon={numero(i + 1, p.feito ? '#1f7a34' : '#c26a00')}>
            <Tooltip>{p.rotulo}</Tooltip>
          </Marker>
        ))}
        <Enquadrar pontos={[destino, ...paradas]} />
      </MapContainer>
    </div>
  );
}

function Clique({ onClick }: { onClick: (p: P) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

export function MapaEscolha({
  centro,
  marcado,
  raioKm,
  outros,
  onEscolher,
}: {
  centro: P;
  marcado: P | null;
  raioKm: number;
  outros: (P & { rotulo: string; raioKm: number })[];
  onEscolher: (p: P) => void;
}) {
  return (
    <div className="mapa alto">
      <MapContainer center={[centro.lat, centro.lng]} zoom={10} style={{ height: '100%' }}>
        <Fundo />
        <Clique onClick={onEscolher} />
        {outros.map((o, i) => (
          <CircleMarker key={i} center={[o.lat, o.lng]} radius={10} pathOptions={{ color: '#b3261e' }}>
            <Tooltip>{o.rotulo}</Tooltip>
          </CircleMarker>
        ))}
        {marcado && (
          <>
            <CircleMarker center={[marcado.lat, marcado.lng]} radius={8} pathOptions={{ color: '#b3261e', fillOpacity: 0.9 }} />
            <Circle center={[marcado.lat, marcado.lng]} radius={raioKm * 1000} pathOptions={{ color: '#b3261e', fillOpacity: 0.1, weight: 1 }} />
          </>
        )}
      </MapContainer>
    </div>
  );
}
