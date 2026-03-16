'use client'

import React from 'react'

export default function MenuSkeleton() {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      {/* Search Header Skeleton */}
      <header style={{ padding: '16px', borderBottom: '1px solid #f5f5f5' }}>
        <div style={{ width: '150px', height: '24px', background: '#f5f5f5', borderRadius: '4px', marginBottom: '16px' }} className="skeleton-pulse"></div>
        <div style={{ width: '100%', height: '40px', background: '#f5f5f5', borderRadius: '8px' }} className="skeleton-pulse"></div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <div style={{ flex: 1, height: '48px', background: '#f5f5f5', borderRadius: '8px' }} className="skeleton-pulse"></div>
          <div style={{ width: '90px', height: '48px', background: '#f5f5f5', borderRadius: '8px' }} className="skeleton-pulse"></div>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar Skeleton */}
        <div style={{ width: '90px', background: '#f9f9f9', padding: '12px 0' }}>
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} style={{ width: '60px', height: '20px', background: '#eee', borderRadius: '4px', margin: '0 auto 24px' }} className="skeleton-pulse"></div>
          ))}
        </div>

        {/* Main Content Skeleton */}
        <div style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>
          <div style={{ width: '100px', height: '20px', background: '#f5f5f5', borderRadius: '4px', marginBottom: '20px' }} className="skeleton-pulse"></div>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
              <div style={{ width: '80px', height: '80px', background: '#f5f5f5', borderRadius: '12px', flexShrink: 0 }} className="skeleton-pulse"></div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ width: '60%', height: '16px', background: '#f5f5f5', borderRadius: '4px', marginBottom: '8px' }} className="skeleton-pulse"></div>
                  <div style={{ width: '40%', height: '12px', background: '#f5f5f5', borderRadius: '4px' }} className="skeleton-pulse"></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ width: '50px', height: '18px', background: '#f5f5f5', borderRadius: '4px' }} className="skeleton-pulse"></div>
                  <div style={{ width: '24px', height: '24px', background: '#f5f5f5', borderRadius: '50%' }} className="skeleton-pulse"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .skeleton-pulse {
          background: linear-gradient(90deg, #f0f0f0 25%, #f8f8f8 50%, #f0f0f0 75%);
          background-size: 200% 100%;
          animation: pulse 1.5s infinite ease-in-out;
        }
        @keyframes pulse {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  )
}
