create table public.payment_orders (
  order_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  check_in date not null,
  check_out date not null,
  guests text not null check (guests in ('1 guest', '2 guests', '3+ guests')),
  room_type text not null check (room_type in ('Superior Room', 'Deluxe Room', 'Premium Room', 'Suite')),
  nightly_rate integer not null check (nightly_rate > 0),
  total_amount integer not null check (total_amount > 0),
  deposit_amount integer not null check (deposit_amount = 1000),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  payment_id text unique,
  created_at timestamptz not null default now(),
  constraint payment_orders_valid_dates check (check_out > check_in)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  check_in date not null,
  check_out date not null,
  guests text not null check (guests in ('1 guest', '2 guests', '3+ guests')),
  room_type text not null check (room_type in ('Superior Room', 'Deluxe Room', 'Premium Room', 'Suite')),
  nightly_rate integer not null check (nightly_rate > 0),
  total_amount integer not null check (total_amount > 0),
  deposit_amount integer not null check (deposit_amount = 1000),
  payment_order_id text not null unique references public.payment_orders (order_id),
  payment_id text not null unique,
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation', 'confirmed', 'credit_issued', 'credit_redeemed')),
  created_at timestamptz not null default now(),
  constraint bookings_valid_dates check (check_out > check_in)
);

alter table public.payment_orders enable row level security;
alter table public.bookings enable row level security;

grant select on public.bookings to authenticated;
grant all on public.payment_orders, public.bookings to service_role;

create policy "Users can view their own bookings"
  on public.bookings
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.confirm_booking_payment(
  p_order_id text,
  p_payment_id text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payment_order public.payment_orders%rowtype;
  booking_id uuid;
begin
  select *
    into payment_order
    from public.payment_orders
    where order_id = p_order_id
    for update;

  if not found then
    raise exception 'Payment order not found';
  end if;

  if payment_order.status = 'paid' then
    if payment_order.payment_id is distinct from p_payment_id then
      raise exception 'Payment order was paid with a different payment';
    end if;

    select id
      into booking_id
      from public.bookings
      where payment_order_id = p_order_id;

    if booking_id is null then
      raise exception 'Paid order has no booking';
    end if;

    return booking_id;
  end if;

  if payment_order.status <> 'pending' then
    raise exception 'Payment order is not pending';
  end if;

  update public.payment_orders
    set status = 'paid', payment_id = p_payment_id
    where order_id = p_order_id;

  insert into public.bookings (
    user_id,
    check_in,
    check_out,
    guests,
    room_type,
    nightly_rate,
    total_amount,
    deposit_amount,
    payment_order_id,
    payment_id
  )
  values (
    payment_order.user_id,
    payment_order.check_in,
    payment_order.check_out,
    payment_order.guests,
    payment_order.room_type,
    payment_order.nightly_rate,
    payment_order.total_amount,
    payment_order.deposit_amount,
    payment_order.order_id,
    p_payment_id
  )
  returning id into booking_id;

  return booking_id;
end;
$$;

revoke all on function public.confirm_booking_payment(text, text) from public, anon, authenticated;
grant execute on function public.confirm_booking_payment(text, text) to service_role;
