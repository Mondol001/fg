import Link from 'next/link';

export default function Home() {
  return (
    <div>
      <h1>Welcome to My Ecommerce Site</h1>
      <Link href="/products">
        <a>View Products</a>
      </Link>
    </div>
  );
}