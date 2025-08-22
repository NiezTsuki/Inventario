-- Users
create table if not exists app_user (
  id serial primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz default now()
);

-- Categories
create table if not exists categoria (
  id serial primary key,
  nombre text not null,
  user_id integer not null references app_user(id) on delete cascade,
  unique (user_id, nombre)
);

-- Products
create table if not exists producto (
  id serial primary key,
  sku text,
  nombre text not null,
  categoria_id integer references categoria(id) on delete set null,
  precio integer not null default 0, -- CLP
  stock integer not null default 0,
  ubicacion text,
  notas text,
  user_id integer not null references app_user(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_producto_user on producto(user_id);
create index if not exists idx_producto_cat on producto(categoria_id);

-- Movements
create table if not exists movimiento (
  id serial primary key,
  producto_id integer not null references producto(id) on delete cascade,
  tipo text not null check (tipo in ('IN','OUT')),
  cantidad integer not null check (cantidad > 0),
  motivo text,
  user_id integer not null references app_user(id) on delete cascade,
  created_at timestamptz default now()
);

-- updated_at trigger
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

drop trigger if exists trg_touch_producto on producto;
create trigger trg_touch_producto
before update on producto
for each row execute function touch_updated_at();
